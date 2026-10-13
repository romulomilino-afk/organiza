/** Meses: resumo, comparação, fechamento do mês (reserva / somar no mês seguinte) e reserva manual. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { decideClosing, monthsWithData, monthSummary, moveReserve, pendingClosing, prevMonthKey, reserveBalance, recentMonthsForNina } from "../src/lib/months";
import { asksHistory } from "../src/lib/nina/context";
import { todayIn } from "../src/lib/dates";

const TZ = "America/Sao_Paulo";
let db: DB;
before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});
const mk = async (email: string) => {
  const [u] = await db.insert(schema.users).values({ email, name: "X", plan: "PREMIUM", onboarded: true, timezone: TZ, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};

test("resumo e comparação de meses", async () => {
  const u = await mk("meses@x.com");
  await db.insert(schema.income).values([{ userId: u.id, amountCents: 500000, description: "Salário", date: "2026-08-05" }, { userId: u.id, amountCents: 500000, description: "Salário", date: "2026-09-05" }]);
  await db.insert(schema.expenses).values([
    { userId: u.id, amountCents: 120000, description: "Mercado", categoryKey: "alimentacao", date: "2026-08-10" },
    { userId: u.id, amountCents: 90000, description: "Mercado", categoryKey: "alimentacao", date: "2026-09-10" },
    { userId: u.id, amountCents: 30000, description: "Uber", categoryKey: "transporte", date: "2026-09-12" },
  ]);
  const ago = await monthSummary(db, u.id, "2026-08"), set = await monthSummary(db, u.id, "2026-09");
  assert.deepEqual([ago.incomeCents, ago.expenseCents, ago.resultCents], [500000, 120000, 380000]);
  assert.deepEqual([set.expenseCents, set.byCategory.alimentacao, set.byCategory.transporte], [120000, 90000, 30000]);
  const months = await monthsWithData(db, u.id, "2026-10-09");
  assert.deepEqual(months.slice(0, 3), ["2026-10", "2026-09", "2026-08"]);
  const nina = await recentMonthsForNina(db, u.id, "2026-10-09");
  assert.equal(nina[0].mes, "setembro de 2026");
  assert.equal(nina[0].categorias_maior_para_menor[0].categoria, "alimentacao");
  assert.equal(asksHistory("quanto gastei em setembro?"), true);
  assert.equal(asksHistory("gastei 45 no almoço"), false);
});

test("fechamento: sobra vai para a reserva ou entra no mês seguinte; só pergunta uma vez", async () => {
  const today = todayIn(TZ);
  const prev = prevMonthKey(today.slice(0, 7));
  const a = await mk("reserva@x.com");
  await db.insert(schema.income).values({ userId: a.id, amountCents: 300000, description: "Salário", date: `${prev}-05` });
  await db.insert(schema.expenses).values({ userId: a.id, amountCents: 100000, description: "Aluguel", date: `${prev}-10` });
  assert.equal((await pendingClosing(db, a.id, today))?.resultCents, 200000);
  await decideClosing(db, a, "RESERVE");
  assert.equal(await reserveBalance(db, a.id), 200000);
  assert.equal(await pendingClosing(db, a.id, today), null, "não pergunta de novo");
  assert.equal(await decideClosing(db, a, "CARRY"), null);

  const b = await mk("carry@x.com");
  await db.insert(schema.income).values({ userId: b.id, amountCents: 300000, description: "Salário", date: `${prev}-05` });
  await decideClosing(db, b, "CARRY");
  const carried = await db.select().from(schema.income).where(and(eq(schema.income.userId, b.id), eq(schema.income.date, `${today.slice(0, 7)}-01`)));
  assert.equal(carried[0]?.amountCents, 300000);
  assert.match(carried[0].description, /^Saldo de /);

  const c = await mk("vermelho@x.com");
  await db.insert(schema.expenses).values({ userId: c.id, amountCents: 50000, description: "Conserto", date: `${prev}-10` });
  await decideClosing(db, c, "CARRY");
  const neg = await db.select().from(schema.expenses).where(and(eq(schema.expenses.userId, c.id), eq(schema.expenses.date, `${today.slice(0, 7)}-01`)));
  assert.equal(neg[0]?.amountCents, 50000);
});

test("reserva manual: guardar, retirar para o mês e não deixar ficar negativa", async () => {
  const u = await mk("manual@x.com");
  await moveReserve(db, u, 100000, "IN", false);
  await moveReserve(db, u, 40000, "OUT", true);
  assert.equal(await reserveBalance(db, u.id), 60000);
  const inc = await db.select().from(schema.income).where(eq(schema.income.userId, u.id));
  assert.equal(inc[0]?.description, "Retirada da reserva");
  await assert.rejects(() => moveReserve(db, u, 999999, "OUT", false), /reserva não tem/);
});
