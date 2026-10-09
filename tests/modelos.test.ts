/** Escolha do modelo da Nina: rápido no dia a dia, esperto nos pedidos difíceis. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseModels, isComplex } from "../src/lib/nina/llm";

test("pedidos simples vão para o modelo rápido; difíceis para o esperto, com o outro de reserva", () => {
  delete process.env.NINA_MODEL; delete process.env.NINA_MODEL_SMART;
  assert.deepEqual(chooseModels("gastei 45 no almoço"), ["claude-haiku-4-5-20251001", "claude-sonnet-5-5"]);
  assert.deepEqual(chooseModels("posso gastar 300 numa jaqueta?"), ["claude-sonnet-5-5", "claude-haiku-4-5-20251001"]);
  assert.equal(isComplex("paguei a luz 180, comprei pão 12, e depois o mercado deu 230"), true);
  assert.equal(isComplex("comprar leite"), false);
  assert.equal(isComplex("comprar leite", "VOICE"), true, "áudio transcrito vai para o esperto");
  process.env.NINA_MODEL_SMART = "off";
  assert.deepEqual(chooseModels("posso gastar 300?"), ["claude-haiku-4-5-20251001"]);
  delete process.env.NINA_MODEL_SMART;
});

test("modelo que não aceita ferramenta forçada: tenta de novo com tool_choice auto e lembra", async () => {
  const { callNina } = await import("../src/lib/nina/llm");
  process.env.ANTHROPIC_API_KEY = "teste";
  const bodies: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    if ((body.tool_choice as { type: string }).type === "tool") {
      return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: "tool_use", id: "tu_1", name: "organizar", input: { reply: "Oi!", actions: [] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const out = await callNina([], "{}", "posso gastar 300?", "modelo-novo-x") as { reply: string };
    assert.equal(out.reply, "Oi!");
    assert.deepEqual(bodies.map((b) => (b.tool_choice as { type: string }).type), ["tool", "auto"]);
    bodies.length = 0;
    await callNina([], "{}", "de novo", "modelo-novo-x");
    assert.deepEqual(bodies.map((b) => (b.tool_choice as { type: string }).type), ["auto"], "lembra e já vai direto no auto");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
