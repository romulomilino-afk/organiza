/**
 * Cartões de crédito: em qual fatura cada parcela cai, faturas, limite e melhor dia de compra.
 *
 * Regra das faturas (a usada pela maioria dos bancos):
 * - compra ANTES do dia de fechamento entra na fatura que fecha neste mês;
 * - compra NO dia do fechamento ou depois entra na fatura do mês seguinte;
 * - a fatura vence no dia de vencimento seguinte ao fechamento;
 * - a parcela N cai N-1 faturas depois da primeira.
 * Por isso o "melhor dia de compra" é o próprio dia do fechamento: é quando se ganha mais prazo para pagar.
 */
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { cardInstallments, cardInvoicePayments, cardPurchases, creditCards, type CreditCard } from "@/db/schema";
import { addMonths, dateInMonth, diffDays, monthStart } from "./dates";

const normText = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// ─────────────── Cálculo (funções puras) ───────────────

/** Vencimento da fatura em que cai uma compra feita em `purchaseDate` (parcela 1). */
export function firstDueDate(purchaseDate: string, closingDay: number, dueDay: number): string {
  let closeMonth = monthStart(purchaseDate);
  if (purchaseDate >= dateInMonth(closeMonth, closingDay)) closeMonth = addMonths(closeMonth, 1);
  const dueMonth = dueDay > closingDay ? closeMonth : addMonths(closeMonth, 1);
  return dateInMonth(dueMonth, dueDay);
}

/** Vencimento da parcela `n` (1 = primeira). */
export function installmentDueDate(purchaseDate: string, closingDay: number, dueDay: number, n: number): string {
  const first = firstDueDate(purchaseDate, closingDay, dueDay);
  return dateInMonth(addMonths(monthStart(first), n - 1), dueDay);
}

/** Dia em que fecha a fatura que vence em `dueDate`. */
export function closingDateFor(dueDate: string, closingDay: number, dueDay: number): string {
  const m = dueDay > closingDay ? monthStart(dueDate) : addMonths(monthStart(dueDate), -1);
  return dateInMonth(m, closingDay);
}

/** Divide o total em parcelas iguais; os centavos que sobram vão na primeira. */
export function splitInstallments(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? totalCents - base * n : 0));
}

/** Melhor dia de compra = dia do fechamento. Também diz se hoje está na "janela boa" (até 5 dias depois de fechar). */
export function bestDay(card: Pick<CreditCard, "closingDay">, today: string) {
  const thisMonth = dateInMonth(today, card.closingDay);
  const lastClose = thisMonth <= today ? thisMonth : dateInMonth(addMonths(monthStart(today), -1), card.closingDay);
  const sinceClose = diffDays(lastClose, today);
  return { day: card.closingDay, goodNow: sinceClose >= 0 && sinceClose <= 5, nextClose: thisMonth > today ? thisMonth : dateInMonth(addMonths(monthStart(today), 1), card.closingDay) };
}

// ─────────────── Consultas ───────────────

export async function userCards(db: DB, userId: string) {
  return db.select().from(creditCards).where(and(eq(creditCards.userId, userId), eq(creditCards.active, true))).orderBy(asc(creditCards.createdAt));
}

/** Acha o cartão pelo nome ("nubank", "Nu", "inter"). Sem nome: o único cartão, ou o primeiro cadastrado. */
export function pickCard(cards: CreditCard[], name?: string | null): CreditCard | null {
  if (!cards.length) return null;
  if (!name) return cards[0];
  const n = normText(name).replace(/^(cartao|cartão|o|do|da|no|na)\s+/g, "");
  return cards.find((c) => normText(c.name) === n) ?? cards.find((c) => normText(c.name).includes(n) || n.includes(normText(c.name))) ?? null;
}

export type Invoice = {
  cardId: string; dueDate: string; closingDate: string; totalCents: number; paid: boolean; paidCents: number | null;
  status: "aberta" | "fechada" | "vencida" | "paga";
  items: { purchaseId: string; description: string; number: number; of: number; amountCents: number; categoryKey: string }[];
};

/** Faturas de um usuário (todos os cartões), de `from` até `to` (por vencimento). */
export async function invoices(db: DB, userId: string, today: string, from: string, to: string, cardIds?: string[]): Promise<Invoice[]> {
  const cards = await userCards(db, userId);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const rows = await db.select({
    cardId: cardInstallments.cardId, dueDate: cardInstallments.dueDate, number: cardInstallments.number, amountCents: cardInstallments.amountCents,
    purchaseId: cardPurchases.id, description: cardPurchases.description, of: cardPurchases.installments, categoryKey: cardPurchases.categoryKey,
  }).from(cardInstallments).innerJoin(cardPurchases, eq(cardPurchases.id, cardInstallments.purchaseId))
    .where(and(eq(cardInstallments.userId, userId), gte(cardInstallments.dueDate, from), lte(cardInstallments.dueDate, to),
      cardIds?.length ? inArray(cardInstallments.cardId, cardIds) : undefined))
    .orderBy(asc(cardInstallments.dueDate), asc(cardPurchases.purchaseDate));
  const paid = await db.select().from(cardInvoicePayments).where(and(eq(cardInvoicePayments.userId, userId), gte(cardInvoicePayments.dueDate, from), lte(cardInvoicePayments.dueDate, to)));
  const paidMap = new Map(paid.map((p) => [`${p.cardId}:${p.dueDate}`, p]));
  const map = new Map<string, Invoice>();
  for (const r of rows) {
    const card = byId.get(r.cardId);
    if (!card) continue;
    const k = `${r.cardId}:${r.dueDate}`;
    let inv = map.get(k);
    if (!inv) {
      const closingDate = closingDateFor(r.dueDate, card.closingDay, card.dueDay);
      const p = paidMap.get(k);
      const status = p ? "paga" : r.dueDate < today ? "vencida" : closingDate <= today ? "fechada" : "aberta";
      inv = { cardId: r.cardId, dueDate: r.dueDate, closingDate, totalCents: 0, paid: !!p, paidCents: p?.amountCents ?? null, status, items: [] };
      map.set(k, inv);
    }
    inv.totalCents += r.amountCents;
    inv.items.push({ purchaseId: r.purchaseId, description: r.description, number: r.number, of: r.of, amountCents: r.amountCents, categoryKey: r.categoryKey });
  }
  return [...map.values()];
}

/** Faturas não pagas que vencem até `until` (para "Contas a pagar" e avisos). */
export async function unpaidInvoicesDue(db: DB, userId: string, today: string, until: string) {
  const all = await invoices(db, userId, today, addMonths(monthStart(today), -3), until);
  const cards = new Map((await userCards(db, userId)).map((c) => [c.id, c]));
  return all.filter((i) => !i.paid && i.status !== "aberta").map((i) => ({ ...i, cardName: cards.get(i.cardId)?.name ?? "Cartão" }));
}

/** Tudo da aba Cartões. */
export async function cardsOverview(db: DB, userId: string, today: string) {
  const cards = await userCards(db, userId);
  if (!cards.length) return [];
  const all = await invoices(db, userId, today, addMonths(monthStart(today), -3), addMonths(monthStart(today), 60));
  return cards.map((card) => {
    const invs = all.filter((i) => i.cardId === card.id);
    const unpaid = invs.filter((i) => !i.paid);
    const toPay = unpaid.filter((i) => i.status !== "aberta").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
    const open = invs.find((i) => i.status === "aberta") ?? null;
    const usedCents = unpaid.reduce((a, i) => a + i.totalCents, 0);
    // compras com parcelas ainda em faturas não pagas
    const pm = new Map<string, { purchaseId: string; description: string; of: number; amountCents: number; next: number; remaining: number; lastDue: string; remainingCents: number }>();
    for (const i of unpaid) for (const it of i.items) {
      const p = pm.get(it.purchaseId) ?? { purchaseId: it.purchaseId, description: it.description, of: it.of, amountCents: it.amountCents, next: it.number, remaining: 0, lastDue: i.dueDate, remainingCents: 0 };
      p.next = Math.min(p.next, it.number); p.remaining++; p.remainingCents += it.amountCents;
      if (i.dueDate > p.lastDue) p.lastDue = i.dueDate;
      pm.set(it.purchaseId, p);
    }
    const purchases = [...pm.values()].sort((a, b) => b.lastDue.localeCompare(a.lastDue));
    const upcoming = unpaid.filter((i) => i.status === "aberta" || i.dueDate > (toPay?.dueDate ?? "")).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6);
    return { card, best: bestDay(card, today), toPay, open, upcoming, usedCents, purchases };
  });
}

/** Parcelas que vencem no mês (entram nos gastos do mês e nas categorias). */
export async function monthCardSpend(db: DB, userId: string, from: string, to: string) {
  const rows = await db.select({ cents: cardInstallments.amountCents, cat: cardPurchases.categoryKey, cardId: cardInstallments.cardId })
    .from(cardInstallments).innerJoin(cardPurchases, eq(cardPurchases.id, cardInstallments.purchaseId))
    .where(and(eq(cardInstallments.userId, userId), gte(cardInstallments.dueDate, from), lte(cardInstallments.dueDate, to)));
  const byCategory: Record<string, number> = {};
  const byCard: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    total += r.cents;
    byCategory[r.cat] = (byCategory[r.cat] ?? 0) + r.cents;
    byCard[r.cardId] = (byCard[r.cardId] ?? 0) + r.cents;
  }
  return { total, byCategory, byCard };
}

// ─────────────── Alterações ───────────────

export async function addPurchase(db: DB, userId: string, card: CreditCard,
  p: { description: string; totalCents: number; installments: number; purchaseDate: string; categoryKey: string }) {
  const [purchase] = await db.insert(cardPurchases).values({ userId, cardId: card.id, ...p }).returning();
  const parts = splitInstallments(p.totalCents, p.installments);
  await db.insert(cardInstallments).values(parts.map((amountCents, i) => ({
    userId, cardId: card.id, purchaseId: purchase.id, number: i + 1, amountCents,
    dueDate: installmentDueDate(p.purchaseDate, card.closingDay, card.dueDay, i + 1),
  })));
  return { purchase, parts, firstDue: installmentDueDate(p.purchaseDate, card.closingDay, card.dueDay, 1), lastDue: installmentDueDate(p.purchaseDate, card.closingDay, card.dueDay, p.installments) };
}

/** Recalcula as parcelas ainda não pagas quando o fechamento/vencimento do cartão muda. */
export async function recomputeCard(db: DB, userId: string, card: CreditCard) {
  const paid = new Set((await db.select({ d: cardInvoicePayments.dueDate }).from(cardInvoicePayments).where(eq(cardInvoicePayments.cardId, card.id))).map((r) => r.d));
  const rows = await db.select({ id: cardInstallments.id, number: cardInstallments.number, dueDate: cardInstallments.dueDate, purchaseDate: cardPurchases.purchaseDate })
    .from(cardInstallments).innerJoin(cardPurchases, eq(cardPurchases.id, cardInstallments.purchaseId))
    .where(and(eq(cardInstallments.userId, userId), eq(cardInstallments.cardId, card.id)));
  for (const r of rows) {
    if (paid.has(r.dueDate)) continue;
    const due = installmentDueDate(r.purchaseDate, card.closingDay, card.dueDay, r.number);
    if (due !== r.dueDate) await db.update(cardInstallments).set({ dueDate: due }).where(eq(cardInstallments.id, r.id));
  }
}

/** Marca como paga a fatura mais antiga em aberto (fechada/vencida); se não houver, a que está aberta. */
export async function payInvoice(db: DB, userId: string, card: CreditCard, today: string, dueDate?: string) {
  const all = (await invoices(db, userId, today, addMonths(monthStart(today), -6), addMonths(monthStart(today), 3), [card.id])).filter((i) => !i.paid);
  const target = dueDate ? all.find((i) => i.dueDate === dueDate)
    : all.filter((i) => i.status !== "aberta").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? all.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (!target) return null;
  const ins = await db.insert(cardInvoicePayments).values({ userId, cardId: card.id, dueDate: target.dueDate, amountCents: target.totalCents }).onConflictDoNothing().returning();
  return ins.length ? target : null;
}

/** Cancela uma compra: some das faturas ainda não pagas. */
export async function cancelPurchase(db: DB, userId: string, purchaseId: string) {
  const [p] = await db.select().from(cardPurchases).where(and(eq(cardPurchases.id, purchaseId), eq(cardPurchases.userId, userId))).limit(1);
  if (!p) return null;
  const paid = (await db.select({ d: cardInvoicePayments.dueDate }).from(cardInvoicePayments).where(eq(cardInvoicePayments.cardId, p.cardId))).map((r) => r.d);
  await db.delete(cardInstallments).where(and(eq(cardInstallments.purchaseId, p.id),
    paid.length ? sql`${cardInstallments.dueDate} not in (${sql.join(paid.map((d) => sql`${d}`), sql`, `)})` : undefined));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(cardInstallments).where(eq(cardInstallments.purchaseId, p.id));
  if (n === 0) await db.delete(cardPurchases).where(eq(cardPurchases.id, p.id));
  else await db.update(cardPurchases).set({ cancelled: true }).where(eq(cardPurchases.id, p.id));
  return p;
}
