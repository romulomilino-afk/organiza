import { and, asc, desc, eq, gte, lte, ne, or, sql, isNotNull, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import {
  events, reminders, tasks, expenses, income, shoppingItems, aiMemory, recurringItems,
  subscriptions, notifications, messages, documents, warranties, type Event,
} from "@/db/schema";
import { visible, type Access } from "../access";
import { addDays, dateInMonth, addMonths, monthStart, monthEnd, todayIn } from "../dates";
import { occursOn } from "../recurrence";

export type Occurrence = { event: Event; day: string };

/** Ocorrências de compromissos entre `from` e `to` (recorrências expandidas). */
export async function occurrences(db: DB, a: Access, from: string, to: string): Promise<Occurrence[]> {
  const rows = await db.select().from(events).where(and(
    visible(events, a), eq(events.cancelled, false), lte(events.date, to),
    or(ne(events.recurrence, "NONE"), gte(events.date, from)),
  )).limit(500);
  const out: Occurrence[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const ev of rows) if (occursOn(ev, d)) out.push({ event: ev, day: d });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.event.time ?? "99").localeCompare(b.event.time ?? "99"));
}

/**
 * Contas recorrentes ("vence todo dia 10") viram uma despesa PENDENTE por mês.
 * Gera o mês atual e o próximo, nunca antes da data em que a conta foi cadastrada. Idempotente.
 */
export async function ensureRecurringBills(db: DB, userId: string, today: string, tz: string) {
  const items = await db.select().from(recurringItems)
    .where(and(eq(recurringItems.userId, userId), eq(recurringItems.active, true), eq(recurringItems.kind, "BILL")));
  for (const it of items) {
    const since = todayIn(tz, it.createdAt);
    for (const ref of [today, addMonths(monthStart(today), 1)]) {
      const due = dateInMonth(ref, it.dayOfMonth);
      if (due < since) continue;
      await db.insert(expenses).values({
        userId, description: it.name, amountCents: it.amountCents, categoryKey: it.categoryKey ?? "casa",
        date: due, dueDate: due, status: "PENDING", recurringItemId: it.id,
      }).onConflictDoNothing();
    }
  }
}

/** Contas pendentes: as minhas e, se a família compartilha o financeiro, as da família. */
export function financeScope(a: Access) {
  return a.household?.active && a.household.shareFinance ? visible(expenses, a) : eq(expenses.userId, a.userId);
}

export async function pendingBills(db: DB, a: Access, until?: string) {
  return db.select().from(expenses).where(and(
    financeScope(a), eq(expenses.status, "PENDING"),
    until ? lte(expenses.dueDate, until) : undefined,
  )).orderBy(asc(expenses.dueDate)).limit(100);
}

export async function openTasks(db: DB, a: Access) {
  return db.select().from(tasks).where(and(visible(tasks, a), eq(tasks.status, "OPEN")))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt)).limit(200);
}

export async function doneTasks(db: DB, a: Access, limit = 10) {
  return db.select().from(tasks).where(and(visible(tasks, a), eq(tasks.status, "DONE")))
    .orderBy(desc(tasks.completedAt)).limit(limit);
}

export async function openReminders(db: DB, userId: string, from: string, to: string) {
  return db.select().from(reminders).where(and(
    eq(reminders.userId, userId), eq(reminders.done, false), gte(reminders.date, from), lte(reminders.date, to),
  )).orderBy(asc(reminders.date), sql`${reminders.time} asc nulls last`).limit(200);
}

export async function shoppingOpen(db: DB, a: Access) {
  return db.select().from(shoppingItems).where(and(visible(shoppingItems, a), eq(shoppingItems.checked, false)))
    .orderBy(asc(shoppingItems.createdAt)).limit(300);
}
export async function shoppingChecked(db: DB, a: Access) {
  return db.select().from(shoppingItems).where(and(visible(shoppingItems, a), eq(shoppingItems.checked, true)))
    .orderBy(desc(shoppingItems.checkedAt)).limit(50);
}

export async function memories(db: DB, userId: string) {
  return db.select().from(aiMemory).where(eq(aiMemory.userId, userId)).orderBy(asc(aiMemory.createdAt)).limit(200);
}

export async function activeSubscriptions(db: DB, userId: string) {
  return db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.active, true))).limit(100);
}

/** Resumo financeiro pessoal do mês de `today` (gastos da família ficam em householdFinance). */
export async function monthFinance(db: DB, userId: string, today: string) {
  const from = monthStart(today), to = monthEnd(today);
  const exp = await db.select().from(expenses).where(and(
    eq(expenses.userId, userId), isNull(expenses.householdId), eq(expenses.status, "PAID"), gte(expenses.date, from), lte(expenses.date, to),
  )).orderBy(desc(expenses.date), desc(expenses.createdAt)).limit(1000);
  const inc = await db.select().from(income).where(and(
    eq(income.userId, userId), gte(income.date, from), lte(income.date, to),
  )).orderBy(desc(income.date), desc(income.createdAt)).limit(500);
  const byCategory: Record<string, number> = {};
  let expenseCents = 0, todayCents = 0;
  for (const e of exp) {
    const v = e.amountCents ?? 0;
    expenseCents += v;
    byCategory[e.categoryKey] = (byCategory[e.categoryKey] ?? 0) + v;
    if (e.date === today) todayCents += v;
  }
  const incomeCents = inc.reduce((a, x) => a + x.amountCents, 0);
  return { from, to, expenses: exp, incomes: inc, byCategory, expenseCents, incomeCents, balanceCents: incomeCents - expenseCents, todayCents };
}

export async function recentMessages(db: DB, userId: string, conversationId: string, limit = 40) {
  const rows = await db.select().from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
}

export async function dismissedKeys(db: DB, userId: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await db.select({ k: notifications.dedupeKey }).from(notifications).where(and(
    eq(notifications.userId, userId), isNotNull(notifications.dismissedAt), inArray(notifications.dedupeKey, keys),
  ));
  return new Set(rows.map((r) => r.k));
}

/** Gastos compartilhados da família no mês (só se a família compartilha o financeiro). */
export async function householdFinance(db: DB, a: Access, today: string) {
  const hh = a.household;
  if (!hh?.active || !hh.shareFinance) return null;
  const from = monthStart(today), to = monthEnd(today);
  const exp = await db.select().from(expenses).where(and(
    eq(expenses.householdId, hh.id), eq(expenses.status, "PAID"), gte(expenses.date, from), lte(expenses.date, to),
  )).orderBy(desc(expenses.date), desc(expenses.createdAt)).limit(1000);
  const byCategory: Record<string, number> = {};
  let totalCents = 0;
  for (const e of exp) { totalCents += e.amountCents ?? 0; byCategory[e.categoryKey] = (byCategory[e.categoryKey] ?? 0) + (e.amountCents ?? 0); }
  return { expenses: exp, byCategory, totalCents };
}

export async function listDocuments(db: DB, userId: string) {
  return db.select().from(documents).where(eq(documents.userId, userId)).orderBy(sql`${documents.expiresAt} asc nulls last`, desc(documents.createdAt)).limit(300);
}

export async function listWarranties(db: DB, userId: string) {
  return db.select().from(warranties).where(eq(warranties.userId, userId)).orderBy(asc(warranties.expiresAt)).limit(300);
}

/** Documentos e garantias que vencem até `until` (para alertas). */
export async function expiringItems(db: DB, userId: string, until: string) {
  const [docs, wars] = await Promise.all([
    db.select().from(documents).where(and(eq(documents.userId, userId), isNotNull(documents.expiresAt), lte(documents.expiresAt, until))).limit(50),
    db.select().from(warranties).where(and(eq(warranties.userId, userId), lte(warranties.expiresAt, until))).limit(50),
  ]);
  return { docs, wars };
}
