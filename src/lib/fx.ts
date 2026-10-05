/**
 * Cotações do dia (Real, Dólar, Euro). Busca uma vez por dia numa fonte gratuita e guarda no banco.
 * Se a fonte estiver fora do ar, usa a última cotação guardada.
 */
import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { fxRates } from "@/db/schema";
import { log } from "./logger";
import type { Currency } from "./money";

export type Rates = { day: string; rates: Record<Currency, number> }; // base: 1 USD

const SOURCES: { name: string; url: string; pick: (j: Record<string, unknown>) => Record<string, number> | null }[] = [
  { name: "open.er-api.com", url: "https://open.er-api.com/v6/latest/USD", pick: (j) => (j.result === "success" ? (j.rates as Record<string, number>) : null) },
  { name: "frankfurter", url: "https://api.frankfurter.app/latest?from=USD&to=BRL,EUR", pick: (j) => (j.rates ? { USD: 1, ...(j.rates as Record<string, number>) } : null) },
];

let lastFailAt = 0; // se a fonte caiu, não tenta de novo por 10 minutos (não deixa a Nina lenta)

async function fetchRates(): Promise<{ rates: Record<Currency, number>; source: string } | null> {
  if (Date.now() - lastFailAt < 10 * 60_000) return null;
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) continue;
      const r = s.pick(await res.json());
      if (r && r.BRL > 0 && r.EUR > 0) return { rates: { USD: 1, BRL: r.BRL, EUR: r.EUR }, source: s.name };
    } catch { /* tenta a próxima fonte */ }
  }
  lastFailAt = Date.now();
  return null;
}

/** Cotação de hoje (ou a mais recente disponível). */
export async function getRates(db: DB, today: string, opts: { fetchIfMissing?: boolean } = { fetchIfMissing: true }): Promise<Rates | null> {
  const [todayRow] = await db.select().from(fxRates).where(eq(fxRates.day, today)).limit(1);
  if (todayRow) return { day: todayRow.day, rates: todayRow.rates as Record<Currency, number> };
  if (opts.fetchIfMissing !== false) {
    const fresh = await fetchRates();
    if (fresh) {
      await db.insert(fxRates).values({ day: today, rates: fresh.rates, source: fresh.source }).onConflictDoNothing();
      return { day: today, rates: fresh.rates };
    }
    log.warn("fx.fetch_failed", {});
  }
  const [last] = await db.select().from(fxRates).orderBy(desc(fxRates.day)).limit(1);
  return last ? { day: last.day, rates: last.rates as Record<Currency, number> } : null;
}

/** Converte centavos de uma moeda para outra. */
export function convert(cents: number, from: Currency, to: Currency, r: Rates): number {
  if (from === to) return cents;
  return Math.round((cents / r.rates[from]) * r.rates[to]);
}

/** Quanto vale 1 unidade de `from` em `to`. */
export function rate(from: Currency, to: Currency, r: Rates): number {
  return r.rates[to] / r.rates[from];
}

/**
 * Troca a moeda em que a Nina trabalha. Com `convertExisting`, converte todos os valores já registrados pela cotação de hoje.
 * Devolve o fator usado (ou null se só trocou o símbolo). Sem cotação disponível, não converte nem troca (evita misturar moedas).
 */
export async function changeCurrency(db: DB, user: { id: string; currency: string; timezone: string }, to: Currency, convertExisting: boolean): Promise<{ changed: boolean; factor: number | null }> {
  const { isCurrency } = await import("./money");
  const from: Currency = isCurrency(user.currency) ? user.currency : "BRL";
  if (from === to) return { changed: false, factor: null };
  const s = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");
  if (!convertExisting) {
    await db.update(s.users).set({ currency: to }).where(eq(s.users.id, user.id));
    return { changed: true, factor: null };
  }
  const { todayIn } = await import("./dates");
  const r = await getRates(db, todayIn(user.timezone));
  if (!r) return { changed: false, factor: null };
  const k = rate(from, to, r);
  const conv = (col: unknown) => sql`round(${col} * ${k}::numeric)::int`;
  await db.transaction(async (tx) => {
    await tx.update(s.expenses).set({ amountCents: conv(s.expenses.amountCents) }).where(eq(s.expenses.userId, user.id));
    await tx.update(s.income).set({ amountCents: conv(s.income.amountCents) }).where(eq(s.income.userId, user.id));
    await tx.update(s.recurringItems).set({ amountCents: conv(s.recurringItems.amountCents) }).where(eq(s.recurringItems.userId, user.id));
    await tx.update(s.subscriptions).set({ amountCents: conv(s.subscriptions.amountCents) }).where(eq(s.subscriptions.userId, user.id));
    await tx.update(s.creditCards).set({ limitCents: conv(s.creditCards.limitCents) }).where(eq(s.creditCards.userId, user.id));
    await tx.update(s.cardPurchases).set({ totalCents: conv(s.cardPurchases.totalCents) }).where(eq(s.cardPurchases.userId, user.id));
    await tx.update(s.cardInstallments).set({ amountCents: conv(s.cardInstallments.amountCents) }).where(eq(s.cardInstallments.userId, user.id));
    await tx.update(s.cardInvoicePayments).set({ amountCents: conv(s.cardInvoicePayments.amountCents) }).where(eq(s.cardInvoicePayments.userId, user.id));
    await tx.update(s.users).set({ currency: to }).where(eq(s.users.id, user.id));
  });
  return { changed: true, factor: k };
}
