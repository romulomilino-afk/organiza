/**
 * Moedas (Real, Dólar, Euro) e cobrança automática no cartão (Asaas Checkout recorrente).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { soloAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";
import { brl, currencyInText, withCurrency } from "../src/lib/money";
import { convert, getRates } from "../src/lib/fx";
import { cancelBilling, handleAsaasEvent, startCheckout } from "../src/lib/billing";
import { todayIn } from "../src/lib/dates";

delete process.env.ANTHROPIC_API_KEY;
const TZ = "America/Sao_Paulo";
let db: DB;
const realFetch = globalThis.fetch;
const mk = async (email: string, plan: "FREE" | "PREMIUM" | "FAMILY" = "PREMIUM", currency = "BRL") => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan, onboarded: true, timezone: TZ, currency, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  // cotação fixa de hoje: 1 US$ = R$ 5,40 · 1 US$ = € 0,92
  await db.insert(schema.fxRates).values({ day: todayIn(TZ), rates: { USD: 1, BRL: 5.4, EUR: 0.92 }, source: "teste" });
});
after(() => { globalThis.fetch = realFetch; });

test("formatação na moeda da pessoa e moeda citada no texto", () => {
  assert.match(withCurrency("USD", () => brl(123456)), /^US\$\s1\.234,56$/);
  assert.match(withCurrency("EUR", () => brl(500)), /^€\s5,00$/);
  assert.match(brl(990), /^R\$\s9,90$/);
  assert.match(withCurrency("USD", () => brl(1490, "BRL")), /^R\$\s14,90$/, "preço do plano sempre em reais");
  assert.deepEqual(["gastei 50 dólares", "paguei 30 euros", "US$ 10", "€ 5", "45 reais", "45 no almoço"].map(currencyInText), ["USD", "EUR", "USD", "EUR", "BRL", null]);
});

test("cotação: usa a do banco e converte entre as três moedas", async () => {
  const r = (await getRates(db, todayIn(TZ), { fetchIfMissing: false }))!;
  assert.equal(convert(10000, "USD", "BRL", r), 54000);
  assert.equal(convert(54000, "BRL", "USD", r), 10000);
  assert.equal(convert(9200, "EUR", "USD", r), 10000);
});

test("Nina: valor em outra moeda é convertido para a moeda da pessoa", async () => {
  const u = await mk("viajante@x.com");
  const r = await handleMessage(db, u, "gastei 50 dólares no almoço");
  assert.match(r.assistant.content, /US\$\s50,00 \(≈ R\$\s270,00\)/);
  const [e] = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id));
  assert.deepEqual([e.description, e.amountCents], ["Almoço", 27000]);

  // pessoa que usa dólar registrando em reais
  const us = await mk("miami@x.com", "PREMIUM", "USD");
  await executeActions(db, soloAccess(us), todayIn(TZ), [ActionSchema.parse({ type: "add_transaction", kind: "expense", amount: 108, category: "alimentacao", description: "Mercado", currency: "BRL" })]);
  const [e2] = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, us.id));
  assert.equal(e2.amountCents, 2000, "R$ 108 = US$ 20");

  const q = await handleMessage(db, u, "quanto é 100 dólares em reais?");
  assert.match(q.assistant.content, /US\$\s100,00 dá R\$\s540,00/);
});

test("Asaas: assinatura com cartão (checkout recorrente) é ligada pelo webhook e ativa o plano", async () => {
  process.env.ASAAS_API_KEY = "teste";
  process.env.AUTH_URL = "https://meuorganiza.com.br";
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });
    const json = String(url).endsWith("/customers") ? { id: "cus_123" } : String(url).endsWith("/checkouts") ? { id: "co_9", link: null } : {};
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const u = await mk("cartao@x.com", "FREE");
  await assert.rejects(() => startCheckout(db, u, "PREMIUM", "529.982.247-25", "CREDIT_CARD", "123"), /celular/);
  const link = await startCheckout(db, u, "PREMIUM", "529.982.247-25", "CREDIT_CARD", "+55 (21) 99876-5432");
  assert.equal(link, "https://sandbox.asaas.com/checkoutSession/show?id=co_9");
  assert.equal(calls.find((c) => c.url.endsWith("/customers"))!.body.mobilePhone, "21998765432", "o Asaas exige o celular do cliente no checkout");
  const co = calls.find((c) => c.url.endsWith("/checkouts"))!;
  assert.deepEqual([co.body.billingTypes, co.body.chargeTypes, co.body.customer], [["CREDIT_CARD"], ["RECURRENT"], "cus_123"]);
  assert.equal((co.body.callback as Record<string, string>).successUrl, "https://meuorganiza.com.br/planos?pago=1");
  assert.equal((co.body.subscription as Record<string, string>).cycle, "MONTHLY");

  let [row] = await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, u.id));
  assert.deepEqual([row.providerSubscriptionId, row.method, row.status], ["checkout:co_9", "CREDIT_CARD", "PENDING"]);

  // o Asaas cria a assinatura e cobra o cartão: o webhook liga e ativa
  await handleAsaasEvent(db, { id: "evt_sub", event: "SUBSCRIPTION_CREATED", subscription: { id: "sub_77", customer: "cus_123" } });
  await handleAsaasEvent(db, { id: "evt_pay", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", subscription: "sub_77", customer: "cus_123", dueDate: "2026-10-05", billingType: "CREDIT_CARD" } });
  [row] = await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, u.id));
  assert.deepEqual([row.providerSubscriptionId, row.status, row.currentPeriodEnd], ["sub_77", "ACTIVE", "2026-11-05"]);
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  assert.equal(me.plan, "PREMIUM");

  // mês seguinte: cobrança automática chega direto pela assinatura
  await handleAsaasEvent(db, { id: "evt_pay2", event: "PAYMENT_CONFIRMED", payment: { id: "pay_2", subscription: "sub_77", customer: "cus_123", dueDate: "2026-11-05" } });
  [row] = await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, u.id));
  assert.equal(row.currentPeriodEnd, "2026-12-05");
});

test("Asaas: pagamento confirmado sem o evento de assinatura também liga; checkout pendente cancelado não rebaixa quem tem acesso liberado", async () => {
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).endsWith("/checkouts") ? { id: "co_x", link: "https://sandbox.asaas.com/c/co_x" } : { id: "cus_456" }), { status: 200 })) as typeof fetch;
  const u = await mk("direto@x.com", "FREE");
  await startCheckout(db, u, "FAMILY", "529.982.247-25", "CREDIT_CARD", "21998765432");
  await handleAsaasEvent(db, { id: "evt_d1", event: "PAYMENT_CONFIRMED", payment: { id: "p", subscription: "sub_88", customer: "cus_456", dueDate: "2026-10-05" } });
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  assert.equal(me.plan, "FAMILY");

  const vip = await mk("vip@x.com", "FAMILY"); // acesso liberado manualmente
  await db.update(schema.users).set({ asaasCustomerId: "cus_vip" }).where(eq(schema.users.id, vip.id));
  const vipCalls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => { vipCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} }); return new Response(JSON.stringify({ id: "co_v" }), { status: 200 }); }) as typeof fetch;
  await startCheckout(db, (await db.select().from(schema.users).where(eq(schema.users.id, vip.id)))[0], "PREMIUM", "", "CREDIT_CARD", "(11) 3456-7890");
  const upd = vipCalls.find((c) => c.url.endsWith("/customers/cus_vip"))!;
  assert.equal(upd.body.mobilePhone, "1134567890", "cliente que já existia no Asaas ganha o celular antes do checkout");
  await cancelBilling(db, vip);
  const [v] = await db.select().from(schema.users).where(eq(schema.users.id, vip.id));
  assert.equal(v.plan, "FAMILY", "cancelar um checkout que nunca foi pago não tira o acesso");
});

test("trocar a moeda da Nina pela conversa: pergunta se converte e aplica a resposta", async () => {
  const u = await mk("troca@x.com");
  await handleMessage(db, u, "gastei 54 reais no almoço");
  const q = await handleMessage(db, u, "Nina, trabalha em dólar");
  assert.match(q.assistant.content, /converta o que você já registrou/);
  await handleMessage(db, u, "sim, converte");
  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  assert.equal(me.currency, "USD");
  const [e] = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id));
  assert.equal(e.amountCents, 1000, "R$ 54 viraram US$ 10");

  await handleMessage(db, me, "muda minha moeda para euro sem converter");
  const [me2] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  const [e2] = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id));
  assert.deepEqual([me2.currency, e2.amountCents], ["EUR", 1000]);
});
