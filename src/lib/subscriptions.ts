/**
 * Assinaturas automáticas: no dia da cobrança viram lançamento de verdade.
 * - Sem cartão: despesa paga (sai da receita como uma conta normal), categoria Assinaturas.
 * - Com cartão: compra à vista no cartão escolhido (entra na fatura certa), categoria Assinaturas.
 * Idempotente (índices únicos por assinatura + data). Assinaturas antigas sem dia de cobrança
 * continuam só como reserva no "Posso gastar?".
 */
import { and, eq, isNotNull, lte } from "drizzle-orm";
import type { DB } from "@/db";
import { cardInstallments, cardPurchases, creditCards, expenses, subscriptions, type Subscription } from "@/db/schema";
import { addMonths, dateInMonth, monthStart } from "./dates";
import { installmentDueDate, splitInstallments } from "./cards";

export const SUB_CATEGORY = "assinaturas";

/** Próxima cobrança a partir de hoje (inclusive) para um dia do mês. */
export function nextChargeFrom(today: string, day: number, cycle: "MONTHLY" | "YEARLY" = "MONTHLY", month?: number) {
  if (cycle === "YEARLY" && month) {
    const y = Number(today.slice(0, 4));
    let d = dateInMonth(`${y}-${String(month).padStart(2, "0")}-01`, day);
    if (d < today) d = dateInMonth(`${y + 1}-${String(month).padStart(2, "0")}-01`, day);
    return d;
  }
  const d = dateInMonth(today, day);
  return d >= today ? d : dateInMonth(addMonths(monthStart(today), 1), day);
}

/** Cobrança seguinte à de `date`. */
export function followingCharge(date: string, day: number, cycle: "MONTHLY" | "YEARLY") {
  return dateInMonth(addMonths(monthStart(date), cycle === "YEARLY" ? 12 : 1), day);
}

/** Lança as cobranças que já chegaram (no máximo 3 por assinatura, se o app ficou parado). */
export async function ensureSubscriptionCharges(db: DB, userId: string, today: string) {
  const subs = await db.select().from(subscriptions).where(and(
    eq(subscriptions.userId, userId), eq(subscriptions.active, true), isNotNull(subscriptions.billingDay), lte(subscriptions.nextBilling, today)));
  let created = 0;
  for (const s of subs) {
    let due = s.nextBilling!;
    const day = s.billingDay!;
    // cartão removido: volta a descontar da conta
    const card = s.cardId ? (await db.select().from(creditCards).where(and(eq(creditCards.id, s.cardId), eq(creditCards.userId, userId), eq(creditCards.active, true))).limit(1))[0] : undefined;
    for (let i = 0; due <= today && i < 3; i++) {
      if (await chargeOnce(db, userId, s, due, card)) created++;
      due = followingCharge(due, day, s.cycle);
    }
    while (due <= today) due = followingCharge(due, day, s.cycle); // muito atrasado: não lança tudo de uma vez
    // só avança se ninguém avançou antes (duas telas abrindo ao mesmo tempo)
    await db.update(subscriptions).set({ nextBilling: due })
      .where(and(eq(subscriptions.id, s.id), eq(subscriptions.nextBilling, s.nextBilling!)));
  }
  return created;
}

async function chargeOnce(db: DB, userId: string, s: Subscription, date: string, card?: typeof creditCards.$inferSelect) {
  if (card) {
    const [p] = await db.insert(cardPurchases).values({
      userId, cardId: card.id, description: s.name, totalCents: s.amountCents, installments: 1, purchaseDate: date,
      categoryKey: SUB_CATEGORY, subscriptionId: s.id,
    }).onConflictDoNothing().returning();
    if (!p) return false;
    const [amountCents] = splitInstallments(s.amountCents, 1);
    await db.insert(cardInstallments).values({ userId, cardId: card.id, purchaseId: p.id, number: 1, amountCents,
      dueDate: installmentDueDate(date, card.closingDay, card.dueDay, 1) });
    return true;
  }
  const r = await db.insert(expenses).values({
    userId, amountCents: s.amountCents, description: s.name, categoryKey: SUB_CATEGORY, date, dueDate: date,
    status: "PAID", paidAt: new Date(), subscriptionId: s.id,
  }).onConflictDoNothing().returning({ id: expenses.id });
  return r.length > 0;
}

/** Valor que ainda vai pesar no mês [from,to] por causa de uma assinatura automática ainda não lançada. */
export function pendingChargeInMonth(s: Pick<Subscription, "nextBilling" | "billingDay" | "cycle" | "amountCents">,
  card: { closingDay: number; dueDay: number } | null, today: string, from: string, to: string) {
  if (!s.nextBilling || !s.billingDay) return 0;
  let total = 0;
  for (let d = s.nextBilling, i = 0; i < 3; d = followingCharge(d, s.billingDay, s.cycle), i++) {
    if (d < today) continue;
    // no cartão, o que pesa é o mês em que a fatura vence
    const when = card ? installmentDueDate(d, card.closingDay, card.dueDay, 1) : d;
    if (when > to) break;
    if (when >= from) total += s.amountCents;
  }
  return total;
}
