/**
 * Teste grátis com cartão: cadastra o cartão, usa 7 dias de graça, a primeira cobrança é no 8º dia.
 * Cancelando antes, a assinatura é apagada no Asaas (nada é cobrado). O Asaas é simulado (fetch falso).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { cancelBilling, cardTrial, handleAsaasEvent, runBillingMaintenance, startCheckout, trialEligible } from "../src/lib/billing";
import { addDays, addMonths, todayIn } from "../src/lib/dates";

process.env.ASAAS_API_KEY = "test-key";
delete process.env.ASAAS_ENV;

let db: DB;
const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
let seq = 0;
const listed: Record<string, { id: string; status: string }[]> = {};
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const path = String(url).replace(/^https:\/\/[^/]+\/v3/, "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method, path, body });
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
  if (method === "POST" && path === "/checkouts") return json({ id: `co_${++seq}`, link: `https://asaas/c/${seq}` });
  if (method === "POST" && path === "/customers") return json({ id: "cus_pix" });
  if (method === "PUT" && path.startsWith("/customers/")) return json({ id: "x" });
  if (method === "POST" && path === "/subscriptions") return json({ id: `sub_pix_${++seq}` });
  if (method === "GET" && /\/subscriptions\/.+\/payments/.test(path)) return json({ data: [{ invoiceUrl: "https://asaas/i/1" }] });
  if (method === "GET" && path.startsWith("/subscriptions?")) {
    const ref = decodeURIComponent((path.match(/externalReference=([^&]+)/) ?? [])[1] ?? "");
    return json({ data: listed[ref] ?? [] });
  }
  if (method === "DELETE") return json({ deleted: true });
  return json({ errors: [{ description: "não simulado" }] }, 400);
}) as typeof fetch;

const tz = "America/Sao_Paulo";
const today = () => todayIn(tz);
const mk = async (email: string) => (await db.insert(schema.users).values({ email, name: "Ana", plan: "FREE", onboarded: true, timezone: tz }).returning())[0];
const user = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];
const rows = async (id: string) => db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, id));
const lastCheckout = () => [...calls].reverse().find((c) => c.path === "/checkouts")!;
let ev = 0;
const send = (event: string, extra: Record<string, unknown>) => handleAsaasEvent(db, { id: `ev_${++ev}`, event, ...extra } as never);

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("cartão no teste: nada cobrado hoje, primeira cobrança no 8º dia, plano liberado ao cadastrar o cartão", async () => {
  const u = await mk("ana@x.com");
  assert.equal(await trialEligible(db, u.id), true);
  const link = await startCheckout(db, u, "PREMIUM", "", "CREDIT_CARD");
  assert.match(link, /asaas\/c\//);
  const co = lastCheckout().body as { subscription: { nextDueDate: string }; callback: { successUrl: string }; items: { description: string }[] };
  const end = addDays(today(), 7);
  assert.equal(co.subscription.nextDueDate, `${end} 00:00:00`);
  assert.match(co.callback.successUrl, /teste=ok/);
  assert.match(co.items[0].description, /7 dias grátis/);
  let [b] = await rows(u.id);
  assert.equal(b.status, "PENDING");
  assert.equal(b.trialEndsAt, end);
  assert.equal((await user(u.id)).plan, "FREE"); // ainda não cadastrou o cartão

  // concluiu o checkout com o cartão
  await send("CHECKOUT_PAID", { checkout: { id: b.providerSubscriptionId.replace("checkout:", ""), customer: "cus_ana" } });
  [b] = await rows(u.id);
  assert.equal(b.status, "ACTIVE");
  assert.equal(b.currentPeriodEnd, end);
  assert.equal((await user(u.id)).plan, "PREMIUM");
  const ct = await cardTrial(db, await user(u.id));
  assert.equal(ct?.daysLeft, 7);
  assert.equal(ct?.chargeDate, end);

  // Asaas cria a assinatura e, no 8º dia, cobra
  await send("SUBSCRIPTION_CREATED", { subscription: { id: "sub_ana", customer: "cus_ana", externalReference: `${u.id}:PREMIUM` } });
  assert.equal((await rows(u.id))[0].providerSubscriptionId, "sub_ana");
  await send("PAYMENT_CONFIRMED", { payment: { id: "pay1", subscription: "sub_ana", customer: "cus_ana", dueDate: end } });
  [b] = await rows(u.id);
  assert.equal(b.currentPeriodEnd, addMonths(end, 1));
  assert.equal(await cardTrial(db, await user(u.id)), null); // já pagou: não é mais teste

  // teste é um só: depois de usar, a próxima assinatura cobra no mesmo dia
  assert.equal(await trialEligible(db, u.id), false);
});

test("cancelar dentro dos 7 dias: apaga a assinatura no Asaas, nada é cobrado e o acesso vai até o fim do teste", async () => {
  const u = await mk("bia@x.com");
  await startCheckout(db, u, "FAMILY", "", "CREDIT_CARD");
  const [b0] = await rows(u.id);
  const coId = b0.providerSubscriptionId.replace("checkout:", "");
  await send("SUBSCRIPTION_CREATED", { subscription: { id: "sub_bia", customer: "cus_bia", externalReference: `${u.id}:FAMILY`, checkoutSession: coId } });
  let [b] = await rows(u.id);
  assert.equal(b.status, "ACTIVE");
  assert.equal((await user(u.id)).plan, "FAMILY");

  calls.length = 0;
  await cancelBilling(db, await user(u.id));
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/subscriptions/sub_bia"), "apagou a assinatura no Asaas");
  [b] = await rows(u.id);
  assert.equal(b.status, "CANCELED");
  assert.equal((await user(u.id)).plan, "FAMILY"); // continua até o fim do teste

  // passou o fim do teste: volta para o Grátis
  await runBillingMaintenance(db, new Date(Date.now() + 9 * 86_400_000));
  assert.equal((await user(u.id)).plan, "FREE");
});

test("cancelou antes de o Asaas avisar a assinatura: procura e apaga; se a assinatura chegar depois, apaga também", async () => {
  const u = await mk("caio@x.com");
  await startCheckout(db, u, "PREMIUM", "", "CREDIT_CARD");
  const [b0] = await rows(u.id);
  const coId = b0.providerSubscriptionId.replace("checkout:", "");
  await send("CHECKOUT_PAID", { checkout: { id: coId, customer: "cus_caio" } });
  listed[`${u.id}:PREMIUM`] = [{ id: "sub_caio", status: "ACTIVE" }];
  calls.length = 0;
  await cancelBilling(db, await user(u.id));
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/subscriptions/sub_caio"));

  calls.length = 0;
  const r = await send("SUBSCRIPTION_CREATED", { subscription: { id: "sub_caio_2", customer: "cus_caio", checkoutSession: coId } });
  assert.equal(r, "processed");
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === "/subscriptions/sub_caio_2"));
  assert.equal((await user(u.id)).plan, "PREMIUM"); // segue até o fim do teste já iniciado
});

test("primeira cobrança recusada depois do teste: volta para o Grátis na hora", async () => {
  const u = await mk("duda@x.com");
  await startCheckout(db, u, "PREMIUM", "", "CREDIT_CARD");
  const [b0] = await rows(u.id);
  await send("SUBSCRIPTION_CREATED", { subscription: { id: "sub_duda", checkoutSession: b0.providerSubscriptionId.replace("checkout:", "") } });
  assert.equal((await user(u.id)).plan, "PREMIUM");
  await send("PAYMENT_OVERDUE", { payment: { id: "p_duda", subscription: "sub_duda", dueDate: b0.trialEndsAt } });
  assert.equal((await user(u.id)).plan, "FREE");
});

test("Pix não tem teste grátis: cobra na hora", async () => {
  const u = await mk("edu@x.com");
  calls.length = 0;
  await startCheckout(db, u, "PREMIUM", "52998224725", "PIX", "", "Edu Lima");
  const sub = calls.find((c) => c.path === "/subscriptions" && c.method === "POST")!;
  assert.equal(sub.body.nextDueDate, today());
  const [b] = await rows(u.id);
  assert.equal(b.trialEndsAt, null);
});
