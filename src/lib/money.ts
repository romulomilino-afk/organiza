/**
 * Dinheiro sempre em centavos (inteiro) no banco, na moeda da pessoa (users.currency).
 *
 * A moeda de quem está usando vale para a requisição inteira:
 * - nas telas (componentes de servidor): `setRequestCurrency(user.currency)` no começo da página (React.cache por requisição);
 * - em rotas, Nina, WhatsApp e avisos: `withCurrency(cur, () => ...)` (AsyncLocalStorage).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";

export const CURRENCIES = {
  BRL: { name: "Real", symbol: "R$", flag: "🇧🇷", words: ["real", "reais"] },
  USD: { name: "Dólar", symbol: "US$", flag: "🇺🇸", words: ["dolar", "dolares"] },
  EUR: { name: "Euro", symbol: "€", flag: "🇪🇺", words: ["euro", "euros"] },
} as const;
export type Currency = keyof typeof CURRENCIES;
export const isCurrency = (c: unknown): c is Currency => typeof c === "string" && c in CURRENCIES;

const als = new AsyncLocalStorage<{ currency: Currency }>();
const box = cache((): { currency: Currency } => ({ currency: "BRL" }));

export function withCurrency<T>(currency: string | null | undefined, fn: () => T): T {
  return als.run({ currency: isCurrency(currency) ? currency : "BRL" }, fn);
}
/** Nas páginas: define a moeda desta requisição (vale para a página e seus componentes). */
export function setRequestCurrency(currency: string | null | undefined) {
  const c = isCurrency(currency) ? currency : "BRL";
  box().currency = c;
  als.enterWith({ currency: c });
}
export function currentCurrency(): Currency {
  return als.getStore()?.currency ?? box().currency ?? "BRL";
}

export function toCents(value: number): number {
  return Math.round(value * 100);
}

/** Formata centavos na moeda indicada (ou na da pessoa). Ex.: R$ 1.234,56 · US$ 1.234,56 · € 1.234,56 */
export function brl(cents: number | null | undefined, currency?: Currency): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: currency ?? currentCurrency() });
}
export const money = brl;

/** "50 dólares", "US$ 50", "€30", "30 euros" → moeda citada no texto (ou null). */
export function currencyInText(text: string): Currency | null {
  const s = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\b(dolar|dolares|usd)\b|us\$|u\$/.test(s)) return "USD";
  if (/\b(euro|euros|eur)\b|€/.test(s)) return "EUR";
  if (/\b(real|reais|brl)\b|r\$/.test(s)) return "BRL";
  return null;
}

export const METHOD_LABEL: Record<string, string> = {
  CARTAO: "Cartão", PIX: "Pix", DINHEIRO: "Dinheiro", DEBITO: "Débito", BOLETO: "Boleto",
};
