/**
 * Pix mensal e Pix anual (Asaas): criação da assinatura, ativação, aviso de vencimento e renovação.
 * O Asaas é simulado (fetch falso): nenhuma chamada real sai daqui.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { cancelBilling, handleAsaasEvent, pixDue, startCheckout } from "../src/lib/billing";
import { yearlyCents } from "../src/lib/plans";
import { addDays, addMonths, todayIn } from "../src/lib/dates";

process.env.ASAAS_API_KEY = "test-key";
delete process.env.ASAAS_ENV;

let db: DB;
const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
let subSeq = 0;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const path = String(url).replace(/^https:\/\/[^/]+\/v3/, "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method, path, body });
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
  if (method === "POST" && path === "/customers") return json({ id: "cus_1" });
  if (method === "PUT" && path.startsWith("/customers/")) return json({ id: path.split("/")[2] });
  if (method === "POST" && path === "/subscriptions") return json({ id: `sub_pix_${++subSeq}` });
  if (method === "GET" && /\/subscriptions\/.+\/payments/.test(path)) return json({ data: [{ invoiceUrl: `https://asaas/i/${path.split("/")[2]}` }] });
  if (method === "DELETE") return json({ deleted: true });
  return json({ errors: [{ description: "não simulado" }] }, 400);
}) as typeof fetch;

const tz = "America/Sao_Paulo";
const mk = async (email: string) => {
  const [u] = await db.insert(schema.users).values({ email, name: "Maria Silva", plan: "FREE", onboarded: true, trialEndsAt: null, timezone: tz }).returning();
  return u;
};
const reload = async (id: string) => (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0];
const billing = async (userId: string) => (await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, userId)))[0];

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("anual tem 10% de desconto sobre 12 meses", () => {
  assert.equal(yearlyCents("PREMIUM"), 21492); // 12 × 19,90 = 238,80 → 214,92
  assert.equal(yearlyCents("FAMILY"), 53892);  // 12 × 49,90 = 598,80 → 538,92
});

test("Pix mensal: pede CPF, cria assinatura PIX mensal, ativa e avisa o próximo vencimento", async () => {
  const u = await mk("pix@f.com");
  await assert.rejects(startCheckout(db, u, "PREMIUM", "123", "PIX", "", "Maria Silva"), /CPF ou CNPJ inválido/);
  calls.length = 0;
  const link = await startCheckout(db, u, "PREMIUM", "529.982.247-25", "PIX", "", "Maria Silva");
  assert.match(link, /^https:\/\/asaas\/i\/sub_pix_/);
  const cust = calls.find((c) => c.path === "/customers")!;
  assert.equal(cust.body.cpfCnpj, "52998224725");
  assert.equal(cust.body.name, "Maria Silva");
  const sub = calls.find((c) => c.path === "/subscriptions" && c.method === "POST")!;
  assert.equal(sub.body.billingType, "PIX");
  assert.equal(sub.body.cycle, "MONTHLY");
  assert.equal(sub.body.value, 19.9);
  assert.equal((await reload(u.id)).asaasCustomerId, "cus_1"); // só o id do cliente; o CPF não é guardado
  assert.ok(!JSON.stringify(await reload(u.id)).includes("52998224725"));

  // clicar de novo reaproveita o mesmo Pix
  assert.equal(await startCheckout(db, u, "PREMIUM", "529.982.247-25", "PIX", "", "Maria Silva"), link);

  let b = await billing(u.id);
  assert.equal(b.method, "PIX");
  assert.equal(await pixDue(db, u), null); // ainda não ativou: a tela de planos mostra o "Pagar com Pix"

  const today = todayIn(tz);
  await handleAsaasEvent(db, { id: "e1", event: "PAYMENT_RECEIVED", payment: { id: "p1", subscription: b.providerSubscriptionId, dueDate: today, invoiceUrl: "https://asaas/recibo1" } });
  assert.equal((await reload(u.id)).plan, "PREMIUM");
  b = await billing(u.id);
  assert.equal(b.status, "ACTIVE");
  assert.equal(b.currentPeriodEnd, addMonths(today, 1));
  assert.equal(b.nextDueDate, null);

  // Asaas gera o Pix do mês seguinte: aparece o aviso só quando faltar até 3 dias
  const next = addMonths(today, 1);
  await handleAsaasEvent(db, { id: "e2", event: "PAYMENT_CREATED", payment: { id: "p2", subscription: b.providerSubscriptionId, dueDate: next, invoiceUrl: "https://asaas/i/p2" } });
  assert.equal((await billing(u.id)).nextDueDate, next);
  assert.equal(await pixDue(db, u), null); // falta ~1 mês
  await db.update(schema.billingSubscriptions).set({ nextDueDate: addDays(today, 2) }).where(eq(schema.billingSubscriptions.userId, u.id));
  const due = await pixDue(db, u);
  assert.ok(due);
  assert.equal(due!.daysLeft, 2);
  assert.equal(due!.url, "https://asaas/i/p2");

  // pagou: aviso some e o acesso estende mais um mês
  await handleAsaasEvent(db, { id: "e3", event: "PAYMENT_RECEIVED", payment: { id: "p2", subscription: b.providerSubscriptionId, dueDate: addDays(today, 2), invoiceUrl: "https://asaas/recibo2" } });
  b = await billing(u.id);
  assert.equal(b.nextDueDate, null);
  assert.equal(await pixDue(db, u), null);
  assert.ok(b.currentPeriodEnd! >= addMonths(today, 1));

  // cancelar apaga a assinatura no Asaas e mantém o acesso até o fim do período pago
  await cancelBilling(db, (await reload(u.id))!);
  assert.ok(calls.some((c) => c.method === "DELETE" && c.path === `/subscriptions/${b.providerSubscriptionId}`));
  assert.equal((await reload(u.id)).plan, "PREMIUM");
});

test("Pix anual: cobra o valor com desconto, ciclo anual e libera por 12 meses", async () => {
  const u = await mk("anual@f.com");
  calls.length = 0;
  await startCheckout(db, u, "FAMILY", "52998224725", "PIX_YEARLY", "", "Maria Silva");
  const sub = calls.find((c) => c.path === "/subscriptions" && c.method === "POST")!;
  assert.equal(sub.body.billingType, "PIX");
  assert.equal(sub.body.cycle, "YEARLY");
  assert.equal(sub.body.value, 538.92);
  const b = await billing(u.id);
  assert.equal(b.valueCents, 53892);
  const today = todayIn(tz);
  await handleAsaasEvent(db, { id: "y1", event: "PAYMENT_RECEIVED", payment: { id: "py1", subscription: b.providerSubscriptionId, dueDate: today } });
  assert.equal((await reload(u.id)).plan, "FAMILY");
  assert.equal((await billing(u.id)).currentPeriodEnd, addMonths(today, 12));
});

test("Pix atrasado: aviso de vencido continua aparecendo", async () => {
  const u = await mk("atraso@f.com");
  await startCheckout(db, u, "PREMIUM", "52998224725", "PIX", "", "Maria Silva");
  const b = await billing(u.id);
  const today = todayIn(tz);
  await handleAsaasEvent(db, { id: "a1", event: "PAYMENT_RECEIVED", payment: { id: "pa1", subscription: b.providerSubscriptionId, dueDate: today } });
  const late = addDays(today, -2);
  await handleAsaasEvent(db, { id: "a2", event: "PAYMENT_OVERDUE", payment: { id: "pa2", subscription: b.providerSubscriptionId, dueDate: late, invoiceUrl: "https://asaas/i/pa2" } });
  const due = await pixDue(db, u);
  assert.ok(due);
  assert.equal(due!.daysLeft, -2);
  assert.equal((await billing(u.id)).status, "OVERDUE");
});
