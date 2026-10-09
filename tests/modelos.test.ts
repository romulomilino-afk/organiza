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
