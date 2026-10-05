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
