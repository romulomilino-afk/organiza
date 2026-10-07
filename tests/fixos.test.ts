/**
 * Receitas e despesas fixas: lançamento automático todo mês, contra Postgres real em memória (PGlite).
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { soloAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { ensureRecurringBills, fixedItems, monthFinance, pendingBills } from "../src/lib/data/queries";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";

delete process.env.ANTHROPIC_API_KEY;
const TZ = "America/Sao_Paulo";
const CREATED = new Date("2026-10-01T15:00:00Z"); // 01/10/2026, 12h em São Paulo

let db: DB;
const mk = async (email: string, plan: "FREE" | "PREMIUM" = "PREMIUM") => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan, onboarded: true, timezone: TZ, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, today: string, a: Record<string, unknown>) =>
  executeActions(db, soloAccess(u), today, [ActionSchema.parse(a)]);
const fixAt = async (userId: string) => db.update(schema.recurringItems).set({ createdAt: CREATED }).where(eq(schema.recurringItems.userId, userId));
const incomes = (userId: string) => db.select().from(schema.income).where(eq(schema.income.userId, userId)).orderBy(schema.income.date);
const paid = (userId: string) => db.select().from(schema.expenses).where(and(eq(schema.expenses.userId, userId), eq(schema.expenses.status, "PAID"))).orderBy(schema.expenses.date);

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("receita fixa: lança sozinha no dia, uma vez por mês, e não volta se for apagada", async () => {
  const u = await mk("salario@x.com");
  const r = await run(u, "2026-10-01", { type: "add_fixed", kind: "income", name: "salário", amount: 4200, day: 5, category: "salario" });
  assert.match(r.cards[0].title, /^Salário · R\$\s4\.200,00$/);
  await fixAt(u.id);
  assert.equal((await incomes(u.id)).length, 0, "antes do dia 5 nada é lançado");

  await ensureRecurringBills(db, u.id, "2026-10-05", TZ);
  await ensureRecurringBills(db, u.id, "2026-10-05", TZ);
  let inc = await incomes(u.id);
  assert.equal(inc.length, 1);
  assert.deepEqual([inc[0].date, inc[0].amountCents, inc[0].description, inc[0].categoryKey], ["2026-10-05", 420000, "Salário", "salario"]);
  assert.equal((await monthFinance(db, u.id, "2026-10-05")).incomeCents, 420000);

  // o usuário apagou (o salário atrasou): não é recriado
  await db.delete(schema.income).where(eq(schema.income.id, inc[0].id));
  await ensureRecurringBills(db, u.id, "2026-10-20", TZ);
  assert.equal((await incomes(u.id)).length, 0);

  // mês seguinte volta a lançar
  await ensureRecurringBills(db, u.id, "2026-11-05", TZ);
  assert.deepEqual((await incomes(u.id)).map((i) => i.date), ["2026-11-05"]);

  // app parado por meses: recupera no máximo os 3 últimos meses
  await ensureRecurringBills(db, u.id, "2027-03-10", TZ);
  assert.deepEqual((await incomes(u.id)).map((i) => i.date), ["2026-11-05", "2027-01-05", "2027-02-05", "2027-03-05"]);
});

test("despesa fixa automática entra como paga; conta fixa vira conta a pagar", async () => {
  const u = await mk("aluguel@x.com");
  await run(u, "2026-10-01", { type: "add_fixed", kind: "expense", name: "aluguel", amount: 1500, day: 10, category: "casa" });
  await run(u, "2026-10-01", { type: "add_fixed", kind: "expense", name: "escola", amount: 900, day: 15, category: "educacao", auto: false });
  await fixAt(u.id);

  const bills = await pendingBills(db, soloAccess(u));
  assert.deepEqual(bills.map((b) => [b.description, b.dueDate, b.amountCents]), [["Escola", "2026-10-15", 90000], ["Escola", "2026-11-15", 90000]]);

  await ensureRecurringBills(db, u.id, "2026-10-10", TZ);
  const p = await paid(u.id);
  assert.deepEqual(p.map((e) => [e.description, e.date, e.amountCents, e.categoryKey]), [["Aluguel", "2026-10-10", 150000, "casa"]]);

  const f = await fixedItems(db, u.id);
  assert.equal(f.incomeCents, 0);
  assert.equal(f.expenseCents, 240000);
  assert.equal(f.leftoverCents, -240000);
});

test("dia 31 em mês curto cai no último dia; alterar e cancelar", async () => {
  const u = await mk("fim@x.com");
  await run(u, "2026-10-01", { type: "add_fixed", kind: "income", name: "Aluguel recebido", amount: 800, day: 31, category: "renda_extra" });
  await fixAt(u.id);
  await ensureRecurringBills(db, u.id, "2026-11-30", TZ);
  assert.deepEqual((await incomes(u.id)).map((i) => i.date), ["2026-10-31", "2026-11-30"]);

  const [it] = await db.select().from(schema.recurringItems).where(eq(schema.recurringItems.userId, u.id));
  await run(u, "2026-12-01", { type: "update_fixed", id: it.id, amount: 950 });
  await ensureRecurringBills(db, u.id, "2026-12-31", TZ);
  assert.equal((await incomes(u.id)).at(-1)!.amountCents, 95000);

  await run(u, "2027-01-01", { type: "cancel_fixed", id: it.id });
  await ensureRecurringBills(db, u.id, "2027-01-31", TZ);
  assert.equal((await incomes(u.id)).length, 3);

  // outra pessoa não consegue mexer no fixo de ninguém
  const intruso = await mk("intruso@x.com");
  const r = await run(intruso, "2027-01-01", { type: "update_fixed", id: it.id, amount: 1 });
  assert.equal(r.skipped, 1);
});

test("Nina (modo simples): salário fixo pela conversa, e o plano Grátis não tem financeiro", async () => {
  const u = await mk("nina@x.com");
  const res = await handleMessage(db, u, "Meu salário de 4.200 cai todo dia 5");
  assert.match(res.assistant.content, /todo dia 5/i);
  const f = await fixedItems(db, u.id);
  assert.deepEqual(f.items.map((i) => [i.kind, i.name, i.amountCents, i.dayOfMonth]), [["INCOME", "Salário", 420000, 5]]);

  const free = await mk("free@x.com", "FREE");
  await handleMessage(db, free, "Meu salário de 4.200 cai todo dia 5");
  assert.equal((await fixedItems(db, free.id)).items.length, 0);
});
