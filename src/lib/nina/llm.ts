import Anthropic from "@anthropic-ai/sdk";
import { NINA_SYSTEM } from "./prompt";
import { ORGANIZE_TOOL } from "./actions";
import { log } from "../logger";

export type Turn = { role: "user" | "assistant"; content: string };

let client: Anthropic | null = null;
export function llmEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Chama o Claude com saída estruturada forçada (ferramenta "organizar").
 * Retorna o objeto bruto da ferramenta; a validação acontece em actions.ts.
 */
export async function callNina(history: Turn[], contextJson: string, message: string): Promise<unknown> {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
  const model = process.env.NINA_MODEL || "claude-haiku-4-5-20251001";

  // histórico curto, alternando papéis (turnos consecutivos do mesmo papel são unidos)
  const msgs: Turn[] = [];
  for (const t of [...history, { role: "user" as const, content: `CONTEXTO DO USUÁRIO (JSON):\n${contextJson}\n\nMENSAGEM DO USUÁRIO:\n${message}` }]) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === t.role) last.content += "\n" + t.content;
    else msgs.push({ ...t });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  const started = Date.now();
  const res = await client.messages.create({
    model,
    max_tokens: 1200,
    temperature: 0.2,
    system: [{ type: "text", text: NINA_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [ORGANIZE_TOOL],
    tool_choice: { type: "tool", name: ORGANIZE_TOOL.name },
    messages: msgs,
  });
  log.info("nina.llm", {
    model, ms: Date.now() - started, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
    cache_read: res.usage.cache_read_input_tokens ?? 0, stop: res.stop_reason,
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Modelo não chamou a ferramenta");
  return block.input;
}
