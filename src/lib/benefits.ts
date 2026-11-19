/**
 * Vales da empresa (alimentação, refeição): um "cartão" com saldo próprio.
 * - Todo mês, no dia do crédito, entra o valor do benefício e soma ao saldo.
 * - Os gastos saem do saldo do vale, nunca da receita: não entram em despesas, "Posso gastar?" nem na saúde financeira.
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { benefitCards, benefitEntries, type BenefitCard } from "@/db/schema";
import { addDays, addMonths, dateInMonth, diffDays, monthEnd, monthStart, todayIn } from "./dates";

export const BENEFIT_KIND = {
  ALIMENTACAO: { label: "Vale-alimentação", emoji: "🛒", category: "alimentacao" },
  REFEICAO: { label: "Vale-refeição", emoji: "🍴", category: "alimentacao" },
  OUTRO: { label: "Benefício", emoji: "🎁", category: "outros" },
} as const;
export type BenefitKind = keyof typeof BENEFIT_KIND;
export const kindOf = (k: string): BenefitKind => (k in BENEFIT_KIND ? (k as BenefitKind) : "OUTRO");

export async function userBenefits(db: DB, userId: string) {
  return db.select().from(benefitCards).where(and(eq(benefitCards.userId, userId), eq(benefitCards.active, true))).orderBy(asc(benefitCards.createdAt));
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Acha o vale pelo nome, pelo tipo ("refeição", "VR") ou, se só houver um, ele mesmo. */
export function pickBenefit(cards: BenefitCard[], ref?: string | null): BenefitCard | null {
  if (!cards.length) return null;
  if (ref) {
    const r = norm(ref);
    const byName = cards.find((c) => norm(c.name) === r) ?? cards.find((c) => norm(c.name).includes(r) || r.includes(norm(c.name)));
    if (byName) return byName;
    const kind: BenefitKind | null = /refei|\bvr\b/.test(r) ? "REFEICAO" : /aliment|\bva\b|mercado/.test(r) ? "ALIMENTACAO" : null;
    if (kind) { const k = cards.filter((c) => c.kind === kind); if (k.length === 1) return k[0]; }
  }
  return cards.length === 1 ? cards[0] : null;
}

/** Próximo dia de crédito depois de hoje. */
export function nextCreditDate(today: string, day: number) {
  const d = dateInMonth(today, day);
  return d > today ? d : dateInMonth(addMonths(monthStart(today), 1), day);
}

/** Lança os créditos mensais que já chegaram (nunca antes do cadastro; recupera no máximo 3 meses). */
export async function ensureBenefitCredits(db: DB, userId: string, today: string, tz: string) {
  for (const c of await userBenefits(db, userId)) {
    if (c.generatedUntil && c.generatedUntil >= today) continue;
    if (c.monthlyCents <= 0) { await db.update(benefitCards).set({ generatedUntil: today }).where(eq(benefitCards.id, c.id)); continue; }
    // o crédito do próprio dia do cadastro já está no saldo que a pessoa informou
    let start = c.generatedUntil ? addDays(c.generatedUntil, 1) : addDays(todayIn(tz, c.createdAt), 1);
    const floor = addMonths(monthStart(today), -2);
    if (start < floor) start = floor;
    for (let m = monthStart(start); m <= today; m = addMonths(m, 1)) {
      const due = dateInMonth(m, c.creditDay);
      if (due < start || due > today) continue;
      await db.insert(benefitEntries).values({
        userId, cardId: c.id, kind: "CREDITO", amountCents: c.monthlyCents, description: "Crédito do mês",
        categoryKey: BENEFIT_KIND[kindOf(c.kind)].category, date: due, creditRef: due,
      }).onConflictDoNothing();
    }
    await db.update(benefitCards).set({ generatedUntil: today }).where(eq(benefitCards.id, c.id));
  }
}

/** Saldo de um vale (créditos + ajustes − gastos). */
export async function benefitBalance(db: DB, cardId: string) {
  const [r] = await db.select({
    v: sql<number>`coalesce(sum(case when ${benefitEntries.kind} = 'GASTO' then -${benefitEntries.amountCents} else ${benefitEntries.amountCents} end), 0)::int`,
  }).from(benefitEntries).where(eq(benefitEntries.cardId, cardId));
  return Number(r?.v ?? 0);
}

/** Muda o saldo para um valor exato (lança um AJUSTE com a diferença). */
export async function setBenefitBalance(db: DB, userId: string, card: BenefitCard, targetCents: number, today: string) {
  const diff = targetCents - (await benefitBalance(db, card.id));
  if (diff !== 0) {
    await db.insert(benefitEntries).values({ userId, cardId: card.id, kind: "AJUSTE", amountCents: diff, description: "Saldo ajustado", categoryKey: "outros", date: today });
  }
  return targetCents;
}

/** Visão de cada vale para a tela e para a Nina. */
export async function benefitsOverview(db: DB, userId: string, today: string) {
  const cards = await userBenefits(db, userId);
  const from = monthStart(today), to = monthEnd(today);
  return Promise.all(cards.map(async (card) => {
    const [balanceCents, month] = await Promise.all([
      benefitBalance(db, card.id),
      db.select().from(benefitEntries).where(and(eq(benefitEntries.cardId, card.id), gte(benefitEntries.date, from), lte(benefitEntries.date, to)))
        .orderBy(desc(benefitEntries.date), desc(benefitEntries.createdAt)),
    ]);
    const next = nextCreditDate(today, card.creditDay);
    const daysToNext = Math.max(1, diffDays(today, next));
    const spentCents = month.filter((e) => e.kind === "GASTO").reduce((a, e) => a + e.amountCents, 0);
    const perDayCents = Math.max(0, Math.floor(balanceCents / daysToNext));
    return { card, kind: BENEFIT_KIND[kindOf(card.kind)], balanceCents, spentCents, nextCredit: next, daysToNext, perDayCents, entries: month };
  }));
}
