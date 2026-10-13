/**
 * Meses: resumo de qualquer mês, comparação entre meses, fechamento do mês e reserva.
 *
 * Cada mês continua sendo calculado sozinho (receitas − despesas do mês). Quando um mês acaba,
 * a pessoa decide o que fazer com o resultado: guardar na reserva, somar no mês seguinte ou deixar como está.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { expenses, income, monthClosings, reserveMovements, type User } from "@/db/schema";
import { monthFinance } from "@/lib/data/queries";
import { addMonths, MESES, todayIn } from "@/lib/dates";
import { AppError } from "@/lib/errors";

export const monthKey = (day: string) => day.slice(0, 7);
export const prevMonthKey = (key: string) => addMonths(`${key}-01`, -1).slice(0, 7);
export const isMonthKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function monthLabel(key: string, withYear = false) {
  const name = MESES[Number(key.slice(5, 7)) - 1];
  return withYear ? `${name} de ${key.slice(0, 4)}` : name;
}
export const monthShort = (key: string) => `${MESES[Number(key.slice(5, 7)) - 1].slice(0, 3)}/${key.slice(2, 4)}`;

export type MonthSummary = { month: string; incomeCents: number; expenseCents: number; resultCents: number; byCategory: Record<string, number>; count: number };

/** Receitas, despesas (inclui parcelas de cartão do mês) e categorias de um mês qualquer. */
export async function monthSummary(db: DB, userId: string, month: string): Promise<MonthSummary> {
  const f = await monthFinance(db, userId, `${month}-15`);
  return {
    month, incomeCents: f.incomeCents, expenseCents: f.expenseCents, resultCents: f.incomeCents - f.expenseCents,
    byCategory: f.byCategory, count: f.expenses.length + f.incomes.length,
  };
}

/** Meses que têm algum lançamento (mais recente primeiro), sempre incluindo o mês atual. */
export async function monthsWithData(db: DB, userId: string, today: string, limit = 24): Promise<string[]> {
  const ym = (col: typeof expenses.date | typeof income.date) => sql<string>`to_char(${col}, 'YYYY-MM')`;
  const [e, i] = await Promise.all([
    db.selectDistinct({ m: ym(expenses.date) }).from(expenses).where(and(eq(expenses.userId, userId), eq(expenses.status, "PAID"))),
    db.selectDistinct({ m: ym(income.date) }).from(income).where(eq(income.userId, userId)),
  ]);
  const cur = monthKey(today);
  const set = new Set<string>([cur, ...e.map((r) => r.m), ...i.map((r) => r.m)]);
  return [...set].filter((m) => m <= cur).sort().reverse().slice(0, limit);
}

/** Saldo da reserva (soma dos movimentos). */
export async function reserveBalance(db: DB, userId: string): Promise<number> {
  const [r] = await db.select({ total: sql<number>`coalesce(sum(${reserveMovements.amountCents}), 0)::int` }).from(reserveMovements).where(eq(reserveMovements.userId, userId));
  return Number(r?.total ?? 0);
}

export async function reserveHistory(db: DB, userId: string, limit = 10) {
  return db.select().from(reserveMovements).where(eq(reserveMovements.userId, userId)).orderBy(desc(reserveMovements.date), desc(reserveMovements.createdAt)).limit(limit);
}

/** O mês anterior acabou e ainda não foi decidido o que fazer com o resultado? */
export async function pendingClosing(db: DB, userId: string, today: string): Promise<MonthSummary | null> {
  const prev = prevMonthKey(monthKey(today));
  const [done] = await db.select({ m: monthClosings.month }).from(monthClosings).where(and(eq(monthClosings.userId, userId), eq(monthClosings.month, prev))).limit(1);
  if (done) return null;
  const s = await monthSummary(db, userId, prev);
  if (s.count === 0 || s.resultCents === 0) return null;
  return s;
}

export type ClosingDecision = "RESERVE" | "CARRY" | "IGNORE";

/**
 * Decide o que fazer com o resultado do mês anterior.
 * Sobra:     RESERVE = guarda na reserva · CARRY = entra como receita no mês atual · IGNORE = nada.
 * Vermelho:  RESERVE = cobre com a reserva · CARRY = entra como despesa no mês atual · IGNORE = nada.
 */
export async function decideClosing(db: DB, user: User, decision: ClosingDecision) {
  const today = todayIn(user.timezone);
  const s = await pendingClosing(db, user.id, today);
  if (!s) return null;
  const name = monthLabel(s.month);
  const first = `${monthKey(today)}-01`;
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(monthClosings).values({ userId: user.id, month: s.month, resultCents: s.resultCents, decision }).onConflictDoNothing().returning();
    if (!inserted.length) return null; // já decidido (duplo clique)
    if (decision === "RESERVE") {
      await tx.insert(reserveMovements).values({
        userId: user.id, amountCents: s.resultCents, date: today,
        description: s.resultCents > 0 ? `Sobra de ${name}` : `Cobriu o vermelho de ${name}`,
      });
    } else if (decision === "CARRY") {
      if (s.resultCents > 0) await tx.insert(income).values({ userId: user.id, amountCents: s.resultCents, description: `Saldo de ${name}`, categoryKey: "outros", date: first });
      else await tx.insert(expenses).values({ userId: user.id, amountCents: -s.resultCents, description: `Saldo negativo de ${name}`, categoryKey: "outros", date: first, status: "PAID" });
    }
    return { ...s, decision };
  });
}

/** Guardar ou retirar da reserva à mão. Retirada pode entrar como receita no mês atual. */
export async function moveReserve(db: DB, user: User, cents: number, kind: "IN" | "OUT", toMonth: boolean) {
  if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000_00) throw new AppError(400, "Valor inválido.", "invalid_amount");
  const today = todayIn(user.timezone);
  if (kind === "OUT") {
    const bal = await reserveBalance(db, user.id);
    if (cents > bal) throw new AppError(400, "A reserva não tem esse valor.", "insufficient_reserve");
  }
  await db.transaction(async (tx) => {
    await tx.insert(reserveMovements).values({
      userId: user.id, amountCents: kind === "IN" ? cents : -cents, date: today,
      description: kind === "IN" ? "Guardado na reserva" : toMonth ? "Retirado para o mês" : "Retirado da reserva",
    });
    if (kind === "OUT" && toMonth) await tx.insert(income).values({ userId: user.id, amountCents: cents, description: "Retirada da reserva", categoryKey: "outros", date: today });
  });
}

/** Resumo curto dos últimos meses para a Nina responder sobre meses passados e comparar. */
export async function recentMonthsForNina(db: DB, userId: string, today: string, n = 6) {
  const cur = monthKey(today);
  const keys: string[] = [];
  for (let k = prevMonthKey(cur), i = 0; i < n; i++, k = prevMonthKey(k)) keys.push(k);
  const all = await Promise.all(keys.map((k) => monthSummary(db, userId, k)));
  return all.filter((s) => s.count > 0).map((s) => ({
    mes: monthLabel(s.month, true), receitas: s.incomeCents / 100, despesas: s.expenseCents / 100, resultado: s.resultCents / 100,
    categorias_maior_para_menor: Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => ({ categoria: c, total: v / 100 })),
  }));
}
