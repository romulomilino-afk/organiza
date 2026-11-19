/** Eventos para anúncios da Meta: hash dos dados, sem token não envia, e falha não quebra nada. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { metaPayload, requestContext, sendMetaEvent } from "../src/lib/meta";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

test("payload: e-mail e id com hash, valor em reais", () => {
  const p = metaPayload({ name: "StartTrial", eventId: "trial-1", userId: "u1", email: " Fulano@Email.com ", valueCents: 2990 }, 1_800_000_000_000);
  const d = p.data[0];
  assert.equal(d.event_name, "StartTrial");
  assert.equal(d.event_id, "trial-1");
  assert.equal(d.event_time, 1_800_000_000);
  assert.deepEqual(d.user_data.em, [sha("fulano@email.com")]);
  assert.deepEqual(d.user_data.external_id, [sha("u1")]);
  assert.deepEqual(d.custom_data, { value: 29.9, currency: "BRL" });
  assert.ok(!JSON.stringify(p).includes("Fulano"), "e-mail nunca vai em texto");
});

test("contexto da requisição: ip, navegador e cookies do pixel", () => {
  const req = new Request("https://x/api", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "UA", cookie: "a=1; _fbp=fb.1.123.456; _fbc=fb.1.9.abc" } });
  assert.deepEqual(requestContext(req), { ip: "1.2.3.4", userAgent: "UA", fbp: "fb.1.123.456", fbc: "fb.1.9.abc" });
});

test("sem token não envia; com erro de rede não quebra", async (t) => {
  delete process.env.META_CAPI_TOKEN;
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { calls.push(url); throw new Error("rede fora"); });
  assert.equal(await sendMetaEvent({ name: "Lead", eventId: "x" }), false);
  assert.equal(calls.length, 0);
  process.env.META_CAPI_TOKEN = "segredo";
  assert.equal(await sendMetaEvent({ name: "Lead", eventId: "x" }), false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /graph\.facebook\.com\/v21\.0\/2373483593414905\/events/);
  delete process.env.META_CAPI_TOKEN;
});
