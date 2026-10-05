"use server";
/**
 * Ações rápidas da interface (marcar, apagar, adiar…).
 * Todas: sessão obrigatória, entrada validada, escopo do usuário, revalidação das telas.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  tasks, shoppingItems, reminders, events, expenses, income, aiMemory, notifications, users, userPreferences,
} from "@/db/schema";
import { requireAccess, requireUser } from "@/lib/session";
import { sharedHouseholdId, visible } from "@/lib/access";
import { financeScope } from "@/lib/data/queries";
import { addDays, cap, isISODate, todayIn } from "@/lib/dates";
import { defaultListId, ensureUserSetup, householdListId } from "@/lib/data/user-setup";
import { signOut } from "@/auth";
import { onBought } from "@/lib/watch";

const id = z.string().min(1).max(64);
const refresh = () => { revalidatePath("/", "layout"); };

export async function toggleTask(taskId: string) {
  const { user: u, access } = await requireAccess(); const db = getDb();
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, id.parse(taskId)), visible(tasks, access))).limit(1);
  if (!t) return;
  const done = t.status === "OPEN";
  await db.update(tasks).set({ status: done ? "DONE" : "OPEN", completedAt: done ? new Date() : null }).where(eq(tasks.id, t.id));
  refresh();
}

export async function postponeTask(taskId: string) {
  const { user: u, access } = await requireAccess();
  await getDb().update(tasks).set({ dueDate: addDays(todayIn(u.timezone), 1) }).where(and(eq(tasks.id, id.parse(taskId)), visible(tasks, access)));
  refresh();
}

export async function deleteTask(taskId: string) {
  const { user: u, access } = await requireAccess();
  await getDb().delete(tasks).where(and(eq(tasks.id, id.parse(taskId)), visible(tasks, access)));
  refresh();
}

export async function addTask(form: FormData) {
  const u = await requireUser();
  const title = z.string().trim().min(1).max(160).safeParse(form.get("title"));
  if (!title.success) return;
  await getDb().insert(tasks).values({ userId: u.id, title: cap(title.data) });
  refresh();
}

export async function toggleShopping(itemId: string) {
  const { user: u, access } = await requireAccess(); const db = getDb();
  const [i] = await db.select().from(shoppingItems).where(and(eq(shoppingItems.id, id.parse(itemId)), visible(shoppingItems, access))).limit(1);
  if (!i) return;
  await db.update(shoppingItems).set({ checked: !i.checked, checkedAt: i.checked ? null : new Date() }).where(eq(shoppingItems.id, i.id));
  if (!i.checked) await onBought(db, access, [i.name], todayIn(u.timezone));
  refresh();
}

export async function addShopping(form: FormData) {
  const { user: u, access } = await requireAccess(); const db = getDb();
  const raw = z.string().trim().min(1).max(400).safeParse(form.get("items"));
  if (!raw.success) return;
  const names = raw.data.split(/,|\s+e\s+/).map((s) => cap(s.trim())).filter((s) => s && s.length <= 80).slice(0, 30);
  const hh = sharedHouseholdId(access);
  const listId = hh ? await householdListId(db, u.id, hh) : await defaultListId(db, u.id);
  if (names.length) await db.insert(shoppingItems).values(names.map((name) => ({ userId: u.id, listId, name, householdId: hh })));
  refresh();
}

export async function deleteShopping(itemId: string) {
  const { user: u, access } = await requireAccess();
  await getDb().delete(shoppingItems).where(and(eq(shoppingItems.id, id.parse(itemId)), visible(shoppingItems, access)));
  refresh();
}

export async function clearCheckedShopping() {
  const { user: u, access } = await requireAccess();
  await getDb().delete(shoppingItems).where(and(visible(shoppingItems, access), eq(shoppingItems.checked, true)));
  refresh();
}

export async function completeReminder(reminderId: string) {
  const u = await requireUser();
  await getDb().update(reminders).set({ done: true }).where(and(eq(reminders.id, id.parse(reminderId)), eq(reminders.userId, u.id)));
  refresh();
}

/** Cancela o compromisso; em rotinas, remove só a ocorrência do dia (a não ser que all=true). */
export async function cancelEvent(eventId: string, day?: string, all = false) {
  const { user: u, access } = await requireAccess(); const db = getDb();
  const [ev] = await db.select().from(events).where(and(eq(events.id, id.parse(eventId)), visible(events, access))).limit(1);
  if (!ev) return;
  if (ev.recurrence !== "NONE" && !all && day && isISODate(day)) {
    await db.update(events).set({ skipDates: [...ev.skipDates, day] }).where(eq(events.id, ev.id));
  } else {
    await db.update(events).set({ cancelled: true }).where(eq(events.id, ev.id));
  }
  refresh();
}

export async function payBill(expenseId: string) {
  const { user: u, access } = await requireAccess();
  await getDb().update(expenses).set({ status: "PAID", paidAt: new Date(), date: todayIn(u.timezone) })
    .where(and(eq(expenses.id, id.parse(expenseId)), financeScope(access), eq(expenses.status, "PENDING")));
  refresh();
}

export async function deleteExpense(expenseId: string) {
  const u = await requireUser();
  await getDb().delete(expenses).where(and(eq(expenses.id, id.parse(expenseId)), eq(expenses.userId, u.id)));
  refresh();
}

export async function deleteIncome(incomeId: string) {
  const u = await requireUser();
  await getDb().delete(income).where(and(eq(income.id, id.parse(incomeId)), eq(income.userId, u.id)));
  refresh();
}

export async function deleteMemory(memoryId: string) {
  const u = await requireUser();
  await getDb().delete(aiMemory).where(and(eq(aiMemory.id, id.parse(memoryId)), eq(aiMemory.userId, u.id)));
  refresh();
}

export async function dismissAlert(key: string, kind: string, title: string) {
  const u = await requireUser();
  const k = z.string().min(1).max(200).parse(key);
  await getDb().insert(notifications).values({
    userId: u.id, dedupeKey: k, kind: z.string().max(40).parse(kind), title: z.string().max(300).parse(title),
    scheduledFor: new Date(), dismissedAt: new Date(),
  }).onConflictDoUpdate({ target: [notifications.userId, notifications.dedupeKey], set: { dismissedAt: new Date() } });
  refresh();
}

const onboardingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  focus: z.array(z.enum(["agenda", "tarefas", "dinheiro", "casa", "familia", "tudo"])).max(6),
});

export async function completeOnboarding(input: { name: string; focus: string[] }) {
  const u = await requireUser(); const db = getDb();
  const { name, focus } = onboardingSchema.parse(input);
  await ensureUserSetup(db, u.id);
  await db.update(users).set({ name, onboarded: true }).where(eq(users.id, u.id));
  await db.update(userPreferences).set({ focus }).where(eq(userPreferences.userId, u.id));
  refresh();
}

export async function updateName(form: FormData) {
  const u = await requireUser();
  const name = z.string().trim().min(1).max(80).safeParse(form.get("name"));
  if (!name.success) return;
  await getDb().update(users).set({ name: name.data }).where(eq(users.id, u.id));
  refresh();
}

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

/** Moeda da pessoa. Opcional: converter os valores já registrados pela cotação de hoje. */
export async function setCurrencyAction(form: FormData) {
  const u = await requireUser();
  const f = z.object({ currency: z.enum(["BRL", "USD", "EUR"]), convert: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!f.success || f.data.currency === u.currency) return;
  const db = getDb();
  if (f.data.convert === "on") {
    const { getRates, rate } = await import("@/lib/fx");
    const { isCurrency } = await import("@/lib/money");
    const r = await getRates(db, todayIn(u.timezone));
    const from = isCurrency(u.currency) ? u.currency : "BRL";
    if (!r) return; // sem cotação: não muda nada (evita misturar moedas)
    const k = rate(from, f.data.currency, r);
    const { sql } = await import("drizzle-orm");
    const s = await import("@/db/schema");
    const conv = (col: unknown) => sql`round(${col} * ${k})::int`;
    await db.transaction(async (tx) => {
      await tx.update(s.expenses).set({ amountCents: conv(s.expenses.amountCents) }).where(eq(s.expenses.userId, u.id));
      await tx.update(s.income).set({ amountCents: conv(s.income.amountCents) }).where(eq(s.income.userId, u.id));
      await tx.update(s.recurringItems).set({ amountCents: conv(s.recurringItems.amountCents) }).where(eq(s.recurringItems.userId, u.id));
      await tx.update(s.subscriptions).set({ amountCents: conv(s.subscriptions.amountCents) }).where(eq(s.subscriptions.userId, u.id));
      await tx.update(s.creditCards).set({ limitCents: conv(s.creditCards.limitCents) }).where(eq(s.creditCards.userId, u.id));
      await tx.update(s.cardPurchases).set({ totalCents: conv(s.cardPurchases.totalCents) }).where(eq(s.cardPurchases.userId, u.id));
      await tx.update(s.cardInstallments).set({ amountCents: conv(s.cardInstallments.amountCents) }).where(eq(s.cardInstallments.userId, u.id));
      await tx.update(s.cardInvoicePayments).set({ amountCents: conv(s.cardInvoicePayments.amountCents) }).where(eq(s.cardInvoicePayments.userId, u.id));
      await tx.update(users).set({ currency: f.data.currency }).where(eq(users.id, u.id));
    });
  } else {
    await db.update(users).set({ currency: f.data.currency }).where(eq(users.id, u.id));
  }
  refresh();
}
