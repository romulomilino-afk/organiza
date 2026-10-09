import Anthropic from "@anthropic-ai/sdk";
import { NINA_SYSTEM } from "./prompt";
import { ORGANIZE_TOOL } from "./actions";
import { log } from "../logger";

export type Turn = { role: "user" | "assistant"; content: string };

let client: Anthropic | null = null;
// modelos que já sabemos que não aceitam ferramenta forçada (os outros são descobertos no primeiro erro)
const NO_FORCED_TOOL = new Set<string>(["claude-sonnet-5-5", ...(process.env.NINA_AUTO_TOOL_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean)]);
export function llmEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const FAST_DEFAULT = "claude-haiku-4-5-20251001";
const SMART_DEFAULT = "claude-sonnet-5-5";

/** Pedido "difícil": longo, com várias coisas juntas, áudio transcrito ou pergunta de análise/planejamento. */
export function isComplex(text: string, source: "TEXT" | "VOICE" = "TEXT"): boolean {
  if (source === "VOICE") return true;
  if (text.length > 160) return true;
  const parts = text.split(/[,;\n]|\s(?:e depois|depois|também|e também)\s/i).filter((p) => p.trim().length > 3);
  if (parts.length >= 3) return true;
  return /(planej|analis|anális|resum|compar|dica|conselho|economiz|quanto (gastei|sobra|sobrou|posso)|posso (gastar|comprar)|vale a pena|me ajud)/i.test(text);
}

/**
 * Modelos na ordem de tentativa. Rápido e barato (Haiku) para o dia a dia; o mais esperto (Sonnet)
 * para pedidos difíceis. Se o primeiro falhar (limite, instabilidade), tenta o outro antes do modo simples.
 * NINA_MODEL troca o rápido; NINA_MODEL_SMART troca o esperto ("off" desliga).
 */
export function chooseModels(text: string, source: "TEXT" | "VOICE" = "TEXT"): string[] {
  const fast = process.env.NINA_MODEL?.trim() || FAST_DEFAULT;
  const smartEnv = process.env.NINA_MODEL_SMART?.trim();
  const smart = smartEnv === "off" ? null : smartEnv || SMART_DEFAULT;
  if (!smart || smart === fast) return [fast];
  return isComplex(text, source) ? [smart, fast] : [fast, smart];
}

/**
 * Chama o Claude com saída estruturada forçada (ferramenta "organizar").
 * Retorna o objeto bruto da ferramenta; a validação acontece em actions.ts.
 */
export async function callNina(history: Turn[], contextJson: string, message: string, model: string = chooseModels(message)[0]): Promise<unknown> {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25_000 });

  // histórico curto, alternando papéis (turnos consecutivos do mesmo papel são unidos)
  const msgs: Turn[] = [];
  for (const t of [...history, { role: "user" as const, content: `CONTEXTO DO USUÁRIO (JSON):\n${contextJson}\n\nMENSAGEM DO USUÁRIO:\n${message}` }]) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === t.role) last.content += "\n" + t.content;
    else msgs.push({ ...t });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  const started = Date.now();
  // Alguns modelos não aceitam "forçar" a ferramenta (tool_choice tool/any): para eles usamos "auto"
  // com a instrução de sempre responder pela ferramenta. Aprendemos isso no primeiro erro e lembramos.
  const forced = !NO_FORCED_TOOL.has(model);
  const create = (force: boolean) => client!.messages.create({
    model,
    max_tokens: 1200,
    ...(force ? { temperature: 0.2 } : {}),
    system: [
      { type: "text", text: NINA_SYSTEM, cache_control: { type: "ephemeral" } },
      ...(force ? [] : [{ type: "text" as const, text: `IMPORTANTE: responda SEMPRE chamando a ferramenta "${ORGANIZE_TOOL.name}". Nunca responda só com texto.` }]),
    ],
    tools: [ORGANIZE_TOOL],
    tool_choice: force ? { type: "tool", name: ORGANIZE_TOOL.name } : { type: "auto" },
    messages: msgs,
  });
  let res;
  try {
    res = await create(forced);
  } catch (e) {
    if (forced && /tool_choice/i.test(String((e as Error)?.message ?? e))) {
      NO_FORCED_TOOL.add(model);
      log.info("nina.llm_auto_tool", { model });
      res = await create(false);
    } else throw e;
  }
  log.info("nina.llm", {
    model, ms: Date.now() - started, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
    cache_read: res.usage.cache_read_input_tokens ?? 0, stop: res.stop_reason,
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Modelo não chamou a ferramenta");
  return block.input;
}
