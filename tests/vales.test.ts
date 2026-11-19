/**
 * Vale-alimentação / vale-refeição: crédito mensal soma ao saldo do vale, gastos saem do vale
 * e nada disso mexe na receita, nas despesas do mês nem no "Posso gastar?".
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
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";
import { fallbackNina } from "../src/lib/nina/fallback";
import { benefitsOverview, ensureBenefitCredits, nextCreditDate, pickBenefit } from "../src/lib/benefits";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
const TZ = "America/Sao_Paulo";
const mk = async (email: string) => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan: "PREMIUM", onboarded: true, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, today: string, ...as: Record<string, unknown>[]) => executeActions(db, soloAccess(u), today, as.map((a) => ActionSchema.parse(a)));
const one = async (userId: string, today: string) => (await benefitsOverview(db, userId, today))[0];

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("datas do crédito", () => {
  assert.equal(nextCreditDate("2026-11-19", 1), "2026-12-01");
  assert.equal(nextCreditDate("2026-11-19", 25), "2026-11-25");
  assert.equal(nextCreditDate("2026-11-25", 25), "2026-12-25", "no próprio dia, o próximo é o do mês que vem");
});

test("crédito do mês soma ao saldo, gasto sai do vale e a receita não muda", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-19T15:00:00Z") });
  const u = await mk("vale@x.com");
  await run(u, "2026-11-19", { type: "add_fixed", kind: "income", name: "Salário", amount: 3000, day: 5, category: "salario" });
  const r = await run(u, "2026-11-19", { type: "add_benefit_card", kind: "refeicao", monthly: 800, day: 1, balance: 350 });
  assert.match(r.cards[0].lines.join(" "), /Saldo: R\$\s350,00/);
  let v = await one(u.id, "2026-11-19");
  assert.equal(v.balanceCents, 35000);
  assert.equal(v.nextCredit, "2026-12-01");
  assert.equal(v.perDayCents, Math.floor(35000 / 12));

  const before = await monthBudget(db, u.id, "2026-11-19");
  // gasto falado (modo simples da Nina)
  const msg = await handleMessage(db, u, "gastei 45 no almoço com o VR");
  assert.match(msg.assistant.content, /Paguei com o Vale-refeição: Almoço, R\$\s45,00\. Saldo agora: R\$\s305,00/);
  v = await one(u.id, "2026-11-19");
  assert.equal(v.balanceCents, 30500);
  assert.equal(v.spentCents, 4500);

  // nada disso aparece como despesa nem muda o "Posso gastar?"
  const fin = await monthFinance(db, u.id, "2026-11-19");
  assert.equal(fin.expenseCents, 0);
  const after = await monthBudget(db, u.id, "2026-11-19");
  assert.equal(after.freeCents, before.freeCents);
  assert.equal((await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id))).length, 0);

  // dia 1º: entra o crédito, uma vez só
  await ensureBenefitCredits(db, u.id, "2026-11-30", TZ);
  assert.equal((await one(u.id, "2026-11-30")).balanceCents, 30500);
  await ensureRecurringBills(db, u.id, "2026-12-01", TZ);
  await ensureBenefitCredits(db, u.id, "2026-12-01", TZ);
  v = await one(u.id, "2026-12-01");
  assert.equal(v.balanceCents, 30500 + 80000, "o que sobrou continua no saldo");
  assert.equal(v.entries.filter((e) => e.kind === "CREDITO").length, 1);
  await ensureRecurringBills(db, u.id, "2026-12-15", TZ);
  assert.equal((await monthFinance(db, u.id, "2026-12-15")).incomeCents, 300000, "só o salário é receita; o crédito do vale não entra");
  assert.equal((await one(u.id, "2026-12-15")).balanceCents, 30500 + 80000);
});

test("gasto maior que o saldo avisa a diferença", async () => {
  const u = await mk("vale2@x.com");
  await run(u, "2026-11-19", { type: "add_benefit_card", kind: "alimentacao", monthly: 600, day: 5, balance: 100 });
  const r = await run(u, "2026-11-19", { type: "add_benefit_spend", description: "Mercado", amount: 130 });
  assert.match(r.cards[0].lines.join(" "), /faltaram R\$\s30,00/);
});

test("modo simples: cadastro, saldo e 'cartão alimentação' não vira cartão de crédito", () => {
  const cad = fallbackNina("meu vale refeição é de 800 e cai todo dia 1", "2026-11-19");
  assert.deepEqual(cad.actions[0], { type: "add_benefit_card", name: "Vale-refeição", kind: "refeicao", monthly: 800, day: 1, balance: undefined });
  const cad2 = fallbackNina("recebo 600 de VA todo dia 5, saldo 320", "2026-11-19");
  assert.equal(cad2.actions[0].type, "add_benefit_card");
  assert.deepEqual([cad2.actions[0].kind, cad2.actions[0].monthly, cad2.actions[0].day, cad2.actions[0].balance], ["alimentacao", 600, 5, 320]);

  const opts = {
    cards: [{ name: "Nubank", closingDay: 3, dueDay: 10 }],
    benefits: [{ name: "Vale-alimentação", kind: "ALIMENTACAO", balanceCents: 50000, perDayCents: 4000, nextCredit: "2026-12-01", monthlyCents: 80000, creditDay: 1 }],
  };
  const g = fallbackNina("gastei 120 no mercado no cartão alimentação", "2026-11-19", {}, opts);
  assert.equal(g.actions[0].type, "add_benefit_spend");
  assert.deepEqual([g.actions[0].amount, g.actions[0].description, g.actions[0].category], [120, "Mercado", "alimentacao"]);
  const s = fallbackNina("qual o saldo do vale alimentação?", "2026-11-19", {}, opts);
  assert.match(s.reply, /No Vale-alimentação você tem R\$\s500,00\. Dá uns R\$\s40,00 por dia/);
  // compra comum no cartão de crédito continua igual
  assert.equal(fallbackNina("comprei um fone de 300 em 3x no nubank", "2026-11-19", {}, opts).actions[0].type, "add_card_purchase");
});

test("escolhe o vale certo pelo nome ou pelo tipo", () => {
  const base = { userId: "u", monthlyCents: 0, creditDay: 1, active: true, generatedUntil: null, createdAt: new Date() };
  const cards = [{ ...base, id: "a", name: "Alelo", kind: "ALIMENTACAO" }, { ...base, id: "r", name: "Pluxee", kind: "REFEICAO" }];
  assert.equal(pickBenefit(cards, "VR")?.id, "r");
  assert.equal(pickBenefit(cards, "alelo")?.id, "a");
  assert.equal(pickBenefit(cards, null), null);
});
