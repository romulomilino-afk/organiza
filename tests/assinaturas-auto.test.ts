/**
 * Assinaturas automáticas: no dia da cobrança viram saída (conta) ou compra no cartão escolhido,
 * entram em Assinaturas e deixam de ser reserva — sem contar duas vezes.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { soloAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { ensureRecurringBills, monthFinance } from "../src/lib/data/queries";
import { monthBudget } from "../src/lib/budget";
import { cardsOverview } from "../src/lib/cards";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { ensureSubscriptionCharges, followingCharge, nextChargeFrom } from "../src/lib/subscriptions";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
const mk = async (email: string) => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan: "PREMIUM", onboarded: true, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, today: string, ...as: Record<string, unknown>[]) => executeActions(db, soloAccess(u), today, as.map((a) => ActionSchema.parse(a)));
const subOf = async (userId: string, name: string) => (await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.userId, userId))).find((s) => s.name === name)!;

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("datas: próxima cobrança e fim de mês", () => {
  assert.equal(nextChargeFrom("2026-11-12", 15), "2026-11-15");
  assert.equal(nextChargeFrom("2026-11-12", 12), "2026-11-12");
  assert.equal(nextChargeFrom("2026-11-12", 5), "2026-12-05");
  assert.equal(followingCharge("2027-01-31", 31, "MONTHLY"), "2027-02-28");
  assert.equal(followingCharge("2027-02-28", 31, "MONTHLY"), "2027-03-31", "volta para o dia 31");
  assert.equal(followingCharge("2026-11-15", 15, "YEARLY"), "2027-11-15");
});

test("na conta: reserva até o dia, depois vira saída em Assinaturas (uma vez só)", async () => {
  const u = await mk("sub-conta@x.com");
  await run(u, "2026-11-01", { type: "add_fixed", kind: "income", name: "Salário", amount: 5000, day: 5, category: "salario" });
  await ensureRecurringBills(db, u.id, "2026-11-12", "America/Sao_Paulo");
  await run(u, "2026-11-12", { type: "add_subscription", name: "Netflix", amount: 44.9, cycle: "monthly", day: 15 });
  let s = await subOf(u.id, "Netflix");
  assert.deepEqual([s.nextBilling, s.billingDay, s.cardId], ["2026-11-15", 15, null]);

  let b = await monthBudget(db, u.id, "2026-11-12");
  assert.equal(b.subscriptionsCents, 4490, "antes do dia: reservado");
  assert.equal(b.spentCents, 0);

  // chegou o dia: lança sozinha (rodar duas vezes não duplica)
  await ensureRecurringBills(db, u.id, "2026-11-15", "America/Sao_Paulo");
  await ensureSubscriptionCharges(db, u.id, "2026-11-15");
  const exp = await db.select().from(schema.expenses).where(eq(schema.expenses.subscriptionId, s.id));
  assert.equal(exp.length, 1);
  assert.deepEqual([exp[0].description, exp[0].amountCents, exp[0].categoryKey, exp[0].status, exp[0].date], ["Netflix", 4490, "assinaturas", "PAID", "2026-11-15"]);
  s = await subOf(u.id, "Netflix");
  assert.equal(s.nextBilling, "2026-12-15");

  const fin = await monthFinance(db, u.id, "2026-11-15");
  assert.equal(fin.byCategory.assinaturas, 4490);
  b = await monthBudget(db, u.id, "2026-11-15");
  assert.equal(b.subscriptionsCents, 0, "já é gasto de verdade, não reserva");
  assert.equal(b.spentCents, 4490);
  assert.equal(b.next.subscriptionsCents, 4490, "mês que vem continua previsto");
});

test("no cartão: entra na fatura do cartão escolhido, no mês em que a fatura vence", async () => {
  const u = await mk("sub-cartao@x.com");
  await run(u, "2026-11-12", { type: "add_card", name: "Itaú", closingDay: 3, dueDay: 10 }, { type: "add_card", name: "Nubank", closingDay: 25, dueDay: 5 });
  await run(u, "2026-11-12", { type: "add_fixed", kind: "income", name: "Salário", amount: 5000, day: 5, category: "salario" });
  const r = await run(u, "2026-11-12", { type: "add_subscription", name: "Spotify", amount: 21.9, cycle: "monthly", day: 20, card: "itau" });
  assert.match(r.cards[0].lines.join(" "), /cartão Itaú/);
  const s = await subOf(u.id, "Spotify");
  const [itau] = await db.select().from(schema.creditCards).where(eq(schema.creditCards.name, "Itaú"));
  assert.equal(s.cardId, itau.id);

  // 20/11 cai na fatura que fecha 03/12 e vence 10/12: não pesa em novembro, pesa em dezembro
  let b = await monthBudget(db, u.id, "2026-11-12");
  assert.equal(b.subscriptionsCents, 0);
  assert.equal(b.next.subscriptionsCents, 2190);

  await ensureSubscriptionCharges(db, u.id, "2026-11-20");
  await ensureSubscriptionCharges(db, u.id, "2026-11-20");
  const ps = await db.select().from(schema.cardPurchases).where(eq(schema.cardPurchases.subscriptionId, s.id));
  assert.equal(ps.length, 1);
  assert.deepEqual([ps[0].cardId, ps[0].categoryKey, ps[0].installments], [itau.id, "assinaturas", 1]);
  assert.equal((await db.select().from(schema.expenses).where(eq(schema.expenses.subscriptionId, s.id))).length, 0, "não vira despesa solta");

  const ov = await cardsOverview(db, u.id, "2026-11-20");
  const it = ov.find((c) => c.card.name === "Itaú")!;
  assert.equal(it.open?.dueDate, "2026-12-10");
  assert.deepEqual(it.openByCategory, [{ key: "assinaturas", cents: 2190 }]);

  b = await monthBudget(db, u.id, "2026-11-20");
  assert.equal(b.next.cardCents, 2190, "já está na fatura de dezembro");
  assert.equal(b.next.subscriptionsCents, 0, "e não conta de novo como assinatura");
  assert.equal((await monthFinance(db, u.id, "2026-12-15")).byCategory.assinaturas, 2190);
});

test("cartão removido volta a descontar da receita; assinatura antiga sem dia segue como reserva", async () => {
  const u = await mk("sub-misc@x.com");
  await run(u, "2026-11-12", { type: "add_card", name: "Inter", closingDay: 1, dueDay: 8 });
  await run(u, "2026-11-12", { type: "add_subscription", name: "Disney", amount: 30, cycle: "monthly", day: 14, card: "Inter" });
  await run(u, "2026-11-12", { type: "delete_card", card: "Inter" });
  await ensureSubscriptionCharges(db, u.id, "2026-11-14");
  const s = await subOf(u.id, "Disney");
  assert.equal((await db.select().from(schema.expenses).where(eq(schema.expenses.subscriptionId, s.id))).length, 1);

  await run(u, "2026-11-12", { type: "add_subscription", name: "Youtube", amount: 24.9, cycle: "monthly" });
  const y = await subOf(u.id, "Youtube");
  assert.equal(y.billingDay, null);
  await run(u, "2026-11-12", { type: "add_fixed", kind: "income", name: "Salário", amount: 3000, day: 5, category: "salario" });
  const b = await monthBudget(db, u.id, "2026-11-14");
  assert.equal(b.subscriptionsCents, 2490, "sem dia: reserva o valor cheio como antes");
});
