/**
 * Datas de calendário como strings "YYYY-MM-DD", sempre no fuso do usuário.
 * Evita os bugs clássicos de Date + UTC em datas sem horário.
 */
export const DEFAULT_TZ = "America/Sao_Paulo";

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Hora atual "HH:MM" no fuso informado. */
export function nowTimeIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

function toUTC(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fromUTC(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = toUTC(s);
  return fromUTC(d) === s;
}
export function isTime(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function addDays(d: string, n: number): string {
  const x = toUTC(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUTC(x);
}

export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fromUTC(target);
}

/** Dias de a até b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

export function weekday(d: string): number {
  return toUTC(d).getUTCDay();
}
export function dayOfMonth(d: string): number {
  return Number(d.slice(8, 10));
}
export function monthKey(d: string): string {
  return d.slice(0, 7);
}
export function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}
export function monthEnd(d: string): string {
  return addDays(addMonths(monthStart(d), 1), -1);
}
/** Data no mês de `ref` com o dia informado (limitado ao último dia do mês). */
export function dateInMonth(ref: string, day: number): string {
  const last = dayOfMonth(monthEnd(ref));
  return `${ref.slice(0, 7)}-${pad(Math.min(Math.max(day, 1), last))}`;
}

export function fmtLong(d: string): string {
  return `${dayOfMonth(d)} de ${MESES[Number(d.slice(5, 7)) - 1]}`;
}
export function fmtBR(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}
export function fmtShort(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** "Hoje", "Amanhã", "Sexta-feira", "20 de outubro"… */
export function relDay(d: string, today: string): string {
  const n = diffDays(today, d);
  if (n === 0) return "Hoje";
  if (n === 1) return "Amanhã";
  if (n === -1) return "Ontem";
  if (n > 1 && n < 7) return cap(DIAS[weekday(d)]);
  return fmtLong(d);
}

export function cap(s: string): string {
  const t = String(s ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
