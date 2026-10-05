/**
 * "Não deixe nada passar": vencimentos/renovações e compras de rotina.
 */
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { deadlines, shoppingItems, shoppingRoutines, type Deadline } from "@/db/schema";
import { visible, sharedHouseholdId, type Access } from "./access";
import { addDays, addMonths, dateInMonth, monthStart } from "./dates";
import { defaultListId, householdListId } from "./data/user-setup";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
export const MESES_N = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * "em dezembro" → 01/12 (deste ano, ou do próximo se já passou); "20 de dezembro" → 20/12; "dezembro de 2027" → 01/12/2027.
 * Devolve também se o dia foi informado (para a Nina poder perguntar o dia exato).
 */
export function parseMonthDate(text: string, today: string): { date: string; exactDay: boolean } | null {
  const s = norm(text);
  const m = s.match(new RegExp(`(?:(\\d{1,2})\\s+de\\s+)?(${MESES_N.join("|")})(?:\\s+(?:de\\s+)?(\\d{4}))?`));
  if (!m) return null;
  const month = MESES_N.indexOf(m[2]) + 1;
  let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
  const day = m[1] ? Number(m[1]) : 1;
  let d = dateInMonth(`${year}-${String(month).padStart(2, "0")}-01`, day);
  if (!m[3] && d < monthStart(today)) { year++; d = dateInMonth(`${year}-${String(month).padStart(2, "0")}-01`, day); }
  return { date: d, exactDay: !!m[1] };
}

// ─────────────── Vencimentos ───────────────

export async function openDeadlines(db: DB, userId: string, until?: string) {
  return db.select().from(deadlines).where(and(eq(deadlines.userId, userId), eq(deadlines.done, false), until ? lte(deadlines.dueDate, until) : undefined))
    .orderBy(asc(deadlines.dueDate)).limit(100);
}

/** Resolvido: se renova (seguro anual), pula para o próximo vencimento; senão, sai da lista. */
export async function completeDeadline(db: DB, userId: string, id: string): Promise<Deadline | null> {
  const [d] = await db.select().from(deadlines).where(and(eq(deadlines.id, id), eq(deadlines.userId, userId))).limit(1);
  if (!d) return null;
  if (d.renewMonths) {
    const [u] = await db.update(deadlines).set({ dueDate: addMonths(d.dueDate, d.renewMonths) }).where(eq(deadlines.id, d.id)).returning();
    return u;
  }
  const [u] = await db.update(deadlines).set({ done: true, doneAt: new Date() }).where(eq(deadlines.id, d.id)).returning();
  return u;
}

/** Quando avisar: `remindDaysBefore` antes do vencimento. */
export const remindFrom = (d: Pick<Deadline, "dueDate" | "remindDaysBefore">) => addDays(d.dueDate, -d.remindDaysBefore);

// ─────────────── Compras de rotina ───────────────

export async function activeRoutines(db: DB, a: Access) {
  return db.select().from(shoppingRoutines).where(and(visible(shoppingRoutines, a), eq(shoppingRoutines.active, true))).orderBy(asc(shoppingRoutines.nextDate));
}

/** Coloca na lista as compras de rotina que chegaram no dia (se já não estiverem lá). Idempotente. */
export async function ensureRoutines(db: DB, a: Access, today: string) {
  const due = await db.select().from(shoppingRoutines)
    .where(and(visible(shoppingRoutines, a), eq(shoppingRoutines.active, true), lte(shoppingRoutines.nextDate, today)));
  for (const r of due) {
    const [open] = await db.select({ id: shoppingItems.id, checked: shoppingItems.checked }).from(shoppingItems)
      .where(and(visible(shoppingItems, a), sql`lower(${shoppingItems.name}) = ${r.name.toLowerCase()}`)).limit(1);
    if (open && !open.checked) { /* já está na lista */ }
    else if (open) await db.update(shoppingItems).set({ checked: false, checkedAt: null, createdAt: new Date() }).where(eq(shoppingItems.id, open.id));
    else {
      const listId = r.householdId ? await householdListId(db, r.userId, r.householdId) : await defaultListId(db, r.userId);
      await db.insert(shoppingItems).values({ userId: r.userId, listId, name: r.name, householdId: r.householdId });
    }
    // próxima vez conta a partir de hoje; se a pessoa comprar antes, `onBought` recomeça a contagem
    await db.update(shoppingRoutines).set({ nextDate: addDays(today, r.everyDays) }).where(eq(shoppingRoutines.id, r.id));
  }
  return due.length;
}

/** Comprou: a contagem recomeça a partir da compra. */
export async function onBought(db: DB, a: Access, names: string[], today: string) {
  if (!names.length) return;
  const rows = await db.select().from(shoppingRoutines).where(and(visible(shoppingRoutines, a), eq(shoppingRoutines.active, true),
    inArray(sql`lower(${shoppingRoutines.name})`, names.map((n) => n.toLowerCase()))));
  for (const r of rows) await db.update(shoppingRoutines).set({ nextDate: addDays(today, r.everyDays) }).where(eq(shoppingRoutines.id, r.id));
}

export async function upsertRoutine(db: DB, a: Access, name: string, everyDays: number, firstDate: string) {
  const hh = sharedHouseholdId(a);
  const [ex] = await db.select().from(shoppingRoutines).where(and(visible(shoppingRoutines, a), sql`lower(${shoppingRoutines.name}) = ${name.toLowerCase()}`)).limit(1);
  if (ex) {
    const [u] = await db.update(shoppingRoutines).set({ everyDays, active: true, nextDate: firstDate }).where(eq(shoppingRoutines.id, ex.id)).returning();
    return u;
  }
  const [r] = await db.insert(shoppingRoutines).values({ userId: a.userId, householdId: hh, name, everyDays, nextDate: firstDate }).returning();
  return r;
}
