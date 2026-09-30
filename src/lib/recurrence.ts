import type { Event } from "@/db/schema";
import { diffDays, weekday, dayOfMonth, addDays } from "./dates";

type Recurring = Pick<Event, "date" | "recurrence" | "interval" | "until" | "skipDates" | "cancelled">;

/** O evento acontece neste dia? (expande recorrências sem gravar ocorrências) */
export function occursOn(ev: Recurring, day: string): boolean {
  if (ev.cancelled) return false;
  if (ev.recurrence === "NONE") return ev.date === day;
  if (day < ev.date) return false;
  if (ev.until && day > ev.until) return false;
  if (ev.skipDates?.includes(day)) return false;
  const interval = Math.max(1, ev.interval || 1);
  switch (ev.recurrence) {
    case "DAILY": return diffDays(ev.date, day) % interval === 0;
    case "WEEKLY": return weekday(ev.date) === weekday(day) && (diffDays(ev.date, day) / 7) % interval === 0;
    case "MONTHLY": {
      const months = (Number(day.slice(0, 4)) - Number(ev.date.slice(0, 4))) * 12 + Number(day.slice(5, 7)) - Number(ev.date.slice(5, 7));
      return dayOfMonth(ev.date) === dayOfMonth(day) && months % interval === 0;
    }
    case "YEARLY": return ev.date.slice(5) === day.slice(5);
  }
  return false;
}

/** Próxima ocorrência a partir de `from` (inclusive), até 400 dias à frente. */
export function nextOccurrence(ev: Recurring, from: string): string | null {
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (occursOn(ev, d)) return d;
  }
  return null;
}

export function recurrenceLabel(ev: Pick<Event, "date" | "recurrence" | "interval">): string {
  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const w = weekday(ev.date);
  switch (ev.recurrence) {
    case "DAILY": return "Todos os dias";
    case "WEEKLY": return `${w === 0 || w === 6 ? "Todo" : "Toda"} ${dias[w]}${ev.interval > 1 ? ` (a cada ${ev.interval} semanas)` : ""}`;
    case "MONTHLY": return `Todo dia ${dayOfMonth(ev.date)}`;
    case "YEARLY": return "Todo ano";
    default: return "";
  }
}
