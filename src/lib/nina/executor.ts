/**
 * Executor: aplica as ações validadas no banco, SEMPRE no escopo do usuário da sessão.
 * Ids citados pela IA são conferidos (dono = usuário, ou item compartilhado da família dele); senão, a ação é ignorada.
 */
import { and, eq, gt, ilike, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  events, tasks, reminders, expenses, income, shoppingItems, recurringItems, subscriptions, warranties, documents, aiMemory, categories,
} from "@/db/schema";
import type { Action } from "./actions";
import { addMonths, cap, dateInMonth, fmtBR, fmtLong, relDay } from "../dates";
import { brl, METHOD_LABEL, toCents } from "../money";
import { CATEGORIES } from "../categories";
import { loadCategories, moveByKeywords, slugKey, upsertCategory } from "../data/user-categories";

const isDefaultKey = (name: string) => slugKey(name) in CATEGORIES;
import { recurrenceLabel } from "../recurrence";
import { defaultListId } from "../data/user-setup";
import { log } from "../logger";
import { sharedHouseholdId, visible, type Access } from "../access";
import { householdListId } from "../data/user-setup";
import { ensureRecurringBills } from "../data/queries";

/** Próximo dia N a partir de hoje (inclusive). */
function nextFixedDate(today: string, day: number) {
  const d = dateInMonth(today, day);
  return d >= today ? d : dateInMonth(addMonths(today.slice(0, 8) + "01", 1), day);
}

import type { Card } from "./types";
export type { Card };
export type ExecResult = { cards: Card[]; executed: Action[]; createdEventIds: string[]; skipped: number };

export async function executeActions(db: DB, access: Access, today: string, actions: Action[]): Promise<ExecResult> {
  const userId = access.userId;
  if (!actions.length) return { cards: [], executed: [], createdEventIds: [], skipped: 0 };
  return db.transaction(async (tx) => {
    const res: ExecResult = { cards: [], executed: [], createdEventIds: [], skipped: 0 };
    for (const a of actions) {
      const card = await runOne(tx as unknown as DB, access, today, a, res.createdEventIds);
      if (card === null) { res.skipped++; continue; }
      res.executed.push(a);
      if (card) res.cards.push(card);
    }
    if (res.skipped) log.warn("nina.actions_skipped", { userId, skipped: res.skipped });
    return res;
  });
}

/** Retorna o cartão de confirmação, `undefined` (executou sem cartão) ou `null` (ignorada). */
async function runOne(db: DB, access: Access, today: string, a: Action, created: string[]): Promise<Card | undefined | null> {
  const userId = access.userId;
  const cats = () => loadCategories(db, userId);
  const hh = sharedHouseholdId(access);
  const famTag = (shared: boolean) => (shared ? ["👨‍👩‍👧 Família"] : []);
  switch (a.type) {
    case "add_event": {
      const recurrence = a.recur ? (a.recur.freq.toUpperCase() as "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY") : "NONE";
      const [ev] = await db.insert(events).values({
        userId, title: cap(a.title), date: a.date, time: a.time ?? null, notes: a.notes ?? null,
        recurrence, interval: a.recur?.interval ?? 1, householdId: a.shared && hh ? hh : null,
      }).returning();
      created.push(ev.id);
      return { icon: "📅", title: ev.title, lines: [recurrence !== "NONE" ? recurrenceLabel(ev) : fmtLong(ev.date), ...(ev.time ? [`⏰ ${ev.time}`] : []), ...famTag(!!ev.householdId)] };
    }
    case "update_event": {
      const patch: Partial<typeof events.$inferInsert> = {};
      if (a.title) patch.title = cap(a.title);
      if (a.date) patch.date = a.date;
      if (a.time) patch.time = a.time;
      if (!Object.keys(patch).length) return null;
      const [ev] = await db.update(events).set(patch).where(and(eq(events.id, a.id), visible(events, access))).returning();
      if (!ev) return null;
      return { icon: "✏️", title: ev.title, lines: [`Agora ${fmtLong(ev.date)}${ev.time ? ` às ${ev.time}` : ""}`] };
    }
    case "cancel_event": {
      const [ev] = await db.update(events).set({ cancelled: true }).where(and(eq(events.id, a.id), visible(events, access))).returning();
      if (!ev) return null;
      return { icon: "🗑️", title: ev.title, lines: ["Compromisso cancelado"] };
    }
    case "set_event_reminder": {
      const id = a.ref.startsWith("new:") ? created[Number(a.ref.slice(4)) || 0] : a.ref;
      if (!id) return null;
      const [ev] = await db.update(events).set({ remindDaysBefore: a.days }).where(and(eq(events.id, id), visible(events, access))).returning();
      if (!ev) return null;
      return { icon: "🔔", title: "Lembrete ativado", lines: [`${a.days === 0 ? "No dia" : `${a.days} dia${a.days > 1 ? "s" : ""} antes`} de ${ev.title.toLowerCase()}`] };
    }
    case "add_task": {
      const [t] = await db.insert(tasks).values({ userId, title: cap(a.title), dueDate: a.due ?? null, householdId: a.shared && hh ? hh : null }).returning();
      return { icon: "✅", title: t.title, lines: [t.dueDate ? `Para ${relDay(t.dueDate, today).toLowerCase()}` : "Tarefa sem data", ...famTag(!!t.householdId)] };
    }
    case "complete_task": {
      const [t] = await db.update(tasks).set({ status: "DONE", completedAt: new Date() }).where(and(eq(tasks.id, a.id), visible(tasks, access))).returning();
      if (!t) return null;
      return { icon: "☑️", title: t.title, lines: ["Concluída"] };
    }
    case "postpone_task": {
      const [t] = await db.update(tasks).set({ dueDate: a.due }).where(and(eq(tasks.id, a.id), visible(tasks, access))).returning();
      if (!t) return null;
      return { icon: "⏭️", title: t.title, lines: [`Adiada para ${relDay(a.due, today).toLowerCase()}`] };
    }
    case "add_reminder": {
      const [r] = await db.insert(reminders).values({ userId, text: cap(a.text), date: a.date, time: a.time ?? null }).returning();
      return { icon: "🔔", title: r.text, lines: [`${relDay(r.date, today)}${r.time ? ` · ${r.time}` : ""}`] };
    }
    case "update_reminder": {
      const patch: Partial<typeof reminders.$inferInsert> = {};
      if (a.text) patch.text = cap(a.text);
      if (a.date) patch.date = a.date;
      if (a.time) patch.time = a.time;
      if (!Object.keys(patch).length) return null;
      const [r] = await db.update(reminders).set(patch).where(and(eq(reminders.id, a.id), eq(reminders.userId, userId))).returning();
      if (!r) return null;
      return { icon: "✏️", title: r.text, lines: [`${relDay(r.date, today)}${r.time ? ` · ${r.time}` : ""}`] };
    }
    case "cancel_reminder": {
      const [r] = await db.update(reminders).set({ done: true }).where(and(eq(reminders.id, a.id), eq(reminders.userId, userId))).returning();
      if (!r) return null;
      return { icon: "🗑️", title: r.text, lines: ["Lembrete cancelado"] };
    }
    case "add_transaction": {
      const cents = toCents(a.amount);
      const date = a.date ?? today;
      const uc = await cats();
      const catKey = uc.resolve(a.category, a.description, a.kind === "income" ? "INCOME" : "EXPENSE");
      const cat = uc.get(catKey);
      if (a.kind === "income") {
        await db.insert(income).values({ userId, amountCents: cents, description: cap(a.description), categoryKey: catKey, date });
        return { icon: "💵", title: `${brl(cents)} · ${cap(a.description)}`, lines: [`${cat.emoji} ${cat.name} · Receita`] };
      }
      const method = a.method ? (a.method.toUpperCase() as "CARTAO" | "PIX" | "DINHEIRO" | "DEBITO" | "BOLETO") : null;
      const sharedFin = !!(a.shared && hh && access.household?.shareFinance);
      await db.insert(expenses).values({ userId, amountCents: cents, description: cap(a.description), categoryKey: catKey, method, date, status: "PAID", paidAt: new Date(), householdId: sharedFin ? hh : null });
      return { icon: "💰", title: `${brl(cents)} · ${cap(a.description)}`, lines: [`${cat.emoji} ${cat.name}${method ? ` · ${METHOD_LABEL[method]}` : ""} · Despesa`, ...famTag(sharedFin)] };
    }
    case "add_bill": {
      const amountCents = a.amount ? toCents(a.amount) : null;
      const billCat = (await cats()).matchKeyword(a.name, "EXPENSE")?.key ?? "casa";
      if (a.dueDay) {
        const [it] = await db.insert(recurringItems).values({ userId, kind: "BILL", name: cap(a.name), amountCents, dayOfMonth: a.dueDay, categoryKey: billCat }).returning();
        let due = dateInMonth(today, a.dueDay);
        if (due < today) due = dateInMonth(addMonths(today.slice(0, 8) + "01", 1), a.dueDay);
        await db.insert(expenses).values({ userId, description: it.name, amountCents, categoryKey: billCat, date: due, dueDate: due, status: "PENDING", recurringItemId: it.id }).onConflictDoNothing();
        return { icon: "🧾", title: it.name, lines: [`Vence todo dia ${a.dueDay}${amountCents ? ` · ${brl(amountCents)}` : ""}`, `Próximo: ${fmtBR(due)}`] };
      }
      const due = a.dueDate!;
      await db.insert(expenses).values({ userId, description: cap(a.name), amountCents, categoryKey: billCat, date: due, dueDate: due, status: "PENDING" });
      return { icon: "🧾", title: cap(a.name), lines: [`Vence ${relDay(due, today).toLowerCase()}${amountCents ? ` · ${brl(amountCents)}` : ""}`] };
    }
    case "pay_bill": {
      const [b] = await db.select().from(expenses).where(and(eq(expenses.id, a.id), visible(expenses, access), eq(expenses.status, "PENDING"))).limit(1);
      if (!b) return null;
      const amountCents = a.amount ? toCents(a.amount) : b.amountCents;
      await db.update(expenses).set({ status: "PAID", paidAt: new Date(), date: today, amountCents }).where(eq(expenses.id, b.id));
      return { icon: "✅", title: `${b.description} paga`, lines: [amountCents ? `${brl(amountCents)} registrado nas despesas` : "Marcada como paga"] };
    }
    case "add_fixed": {
      const amountCents = toCents(a.amount);
      const kind = a.kind === "income" ? "INCOME" : a.auto ? "EXPENSE" : "BILL";
      const uc = await cats();
      const catKey = uc.resolve(a.category, a.name, a.kind === "income" ? "INCOME" : "EXPENSE");
      const [it] = await db.insert(recurringItems).values({ userId, kind, name: cap(a.name), amountCents, dayOfMonth: a.day, categoryKey: catKey }).returning();
      await ensureRecurringBills(db, userId, today, access.timezone);
      const next = nextFixedDate(today, a.day);
      const cat = uc.get(catKey);
      const label = kind === "INCOME" ? "Receita fixa" : kind === "EXPENSE" ? "Despesa fixa" : "Conta fixa";
      const how = kind === "BILL" ? "Te aviso para pagar" : kind === "INCOME" ? "Entra sozinha nas receitas" : "Lança sozinha nas despesas";
      return { icon: kind === "INCOME" ? "💵" : "🔁", title: `${it.name} · ${brl(amountCents)}`,
        lines: [`${label} · todo dia ${a.day} · ${cat.emoji} ${cat.name}`, `${how} · próximo: ${next === today ? "hoje" : fmtBR(next)}`] };
    }
    case "update_fixed": {
      const patch: Partial<typeof recurringItems.$inferInsert> = {};
      if (a.amount) patch.amountCents = toCents(a.amount);
      if (a.day) patch.dayOfMonth = a.day;
      if (a.name) patch.name = cap(a.name);
      if (!Object.keys(patch).length) return null;
      const [it] = await db.update(recurringItems).set(patch).where(and(eq(recurringItems.id, a.id), eq(recurringItems.userId, userId), eq(recurringItems.active, true))).returning();
      if (!it) return null;
      if (it.kind === "BILL") {
        // contas futuras ainda não pagas acompanham a mudança
        await db.delete(expenses).where(and(eq(expenses.recurringItemId, it.id), eq(expenses.status, "PENDING"), gt(expenses.dueDate, today)));
        await ensureRecurringBills(db, userId, today, access.timezone);
      }
      return { icon: "✏️", title: it.name, lines: [`${it.amountCents ? brl(it.amountCents) : "Valor a definir"} · todo dia ${it.dayOfMonth}`, "Vale a partir do próximo lançamento"] };
    }
    case "cancel_fixed": {
      const [it] = await db.update(recurringItems).set({ active: false }).where(and(eq(recurringItems.id, a.id), eq(recurringItems.userId, userId))).returning();
      if (!it) return null;
      await db.delete(expenses).where(and(eq(expenses.recurringItemId, it.id), eq(expenses.status, "PENDING"), gt(expenses.dueDate, today)));
      return { icon: "🗑️", title: it.name, lines: ["Não lanço mais todo mês"] };
    }
    case "add_category": {
      const uc = await cats();
      const kind = a.kind === "income" ? "INCOME" : "EXPENSE";
      if (!uc.find(a.name) && uc.custom().length >= 30) return null;
      const { cat, created: isNew } = await upsertCategory(db, userId, uc, { name: a.name, emoji: a.emoji, kind, keywords: a.keywords.length ? a.keywords : isDefaultKey(a.name) ? [] : [a.name] });
      const moved = await moveByKeywords(db, userId, cat);
      const lines = [
        cat.keywords.length ? `Entra aqui: ${cat.keywords.join(", ")}` : "Use quando quiser: “gastei 50 em " + cat.name.toLowerCase() + "”",
        ...(moved ? [`${moved} lançamento${moved > 1 ? "s" : ""} movido${moved > 1 ? "s" : ""} para cá`] : []),
      ];
      return { icon: cat.emoji, title: isNew ? `Categoria ${cat.name} criada` : `Categoria ${cat.name} atualizada`, lines };
    }
    case "delete_category": {
      const uc = await cats();
      const c = uc.find(a.name);
      if (!c || !c.custom) return null;
      await db.update(expenses).set({ categoryKey: "outros" }).where(and(eq(expenses.userId, userId), eq(expenses.categoryKey, c.key)));
      await db.update(income).set({ categoryKey: "renda_extra" }).where(and(eq(income.userId, userId), eq(income.categoryKey, c.key)));
      await db.update(recurringItems).set({ categoryKey: c.kind === "INCOME" ? "renda_extra" : "outros" }).where(and(eq(recurringItems.userId, userId), eq(recurringItems.categoryKey, c.key)));
      await db.delete(categories).where(and(eq(categories.userId, userId), eq(categories.key, c.key)));
      return { icon: "🗑️", title: `Categoria ${c.name} apagada`, lines: [`Os lançamentos dela foram para ${c.kind === "INCOME" ? "Renda extra" : "Outros"}`] };
    }
    case "add_shopping": {
      // na família, a lista de compras é compartilhada por padrão
      const listId = hh ? await householdListId(db, userId, hh) : await defaultListId(db, userId);
      const names = [...new Set(a.items.map(cap))];
      const existing = await db.select().from(shoppingItems).where(and(visible(shoppingItems, access),
        inArray(sql`lower(${shoppingItems.name})`, names.map((n) => n.toLowerCase()))));
      const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
      for (const n of names) {
        const ex = byName.get(n.toLowerCase());
        if (ex) { if (ex.checked) await db.update(shoppingItems).set({ checked: false, checkedAt: null, createdAt: new Date() }).where(eq(shoppingItems.id, ex.id)); }
        else await db.insert(shoppingItems).values({ userId, listId, name: n, householdId: hh });
      }
      return { icon: "🛒", title: hh ? "Lista de compras da família" : "Lista de compras", lines: names.map((n) => `☐ ${n}`) };
    }
    case "remove_shopping":
    case "check_shopping": {
      let n = 0;
      for (const name of a.items) {
        const where = and(visible(shoppingItems, access), ilike(shoppingItems.name, name.trim().replace(/[%_]/g, "")));
        const rows = a.type === "remove_shopping"
          ? await db.delete(shoppingItems).where(where).returning()
          : await db.update(shoppingItems).set({ checked: true, checkedAt: new Date() }).where(where).returning();
        n += rows.length;
      }
      if (!n) return null;
      return { icon: "🛒", title: a.type === "remove_shopping" ? "Removido da lista" : "Comprado", lines: [a.items.map(cap).join(", ")] };
    }
    case "add_subscription": {
      const cents = toCents(a.amount);
      await db.insert(subscriptions).values({ userId, name: cap(a.name), amountCents: cents, cycle: a.cycle === "yearly" ? "YEARLY" : "MONTHLY" });
      return { icon: "🔄", title: cap(a.name), lines: [`${brl(cents)} / ${a.cycle === "yearly" ? "ano" : "mês"}`] };
    }
    case "cancel_subscription": {
      const [s] = await db.update(subscriptions).set({ active: false }).where(and(eq(subscriptions.id, a.id), eq(subscriptions.userId, userId))).returning();
      if (!s) return null;
      return { icon: "🗑️", title: s.name, lines: ["Assinatura cancelada"] };
    }
    case "add_warranty": {
      const purchaseDate = a.purchaseDate ?? today;
      const expiresAt = addMonths(purchaseDate, a.months);
      await db.insert(warranties).values({ userId, item: cap(a.item), purchaseDate, months: a.months, expiresAt });
      return { icon: "🧾", title: `Garantia do ${a.item.toLowerCase()}`, lines: [`Vencimento: ${fmtBR(expiresAt)}`] };
    }
    case "add_document": {
      await db.insert(documents).values({ userId, name: cap(a.name), category: a.category.toUpperCase() as "OUTRO", date: today, expiresAt: a.expires ?? null, notes: a.notes ?? null });
      return { icon: "📄", title: cap(a.name), lines: [a.expires ? `Vence ${fmtBR(a.expires)} · aviso antes` : "Guardado"] };
    }
    case "remember": {
      const fact = cap(a.fact);
      const [dup] = await db.select({ id: aiMemory.id }).from(aiMemory).where(and(eq(aiMemory.userId, userId), ilike(aiMemory.fact, fact.replace(/[%_]/g, "")))).limit(1);
      if (!dup) await db.insert(aiMemory).values({ userId, fact });
      return undefined; // memória é silenciosa: não gera cartão
    }
  }
}
