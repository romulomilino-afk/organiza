/**
 * Alertas inteligentes, calculados a partir dos dados (sem job em segundo plano no MVP).
 * Poucos e relevantes: no máximo 4 na tela inicial, ordenados por importância.
 * Cada alerta tem uma chave estável para poder ser dispensado (tabela notifications).
 */
import type { Deadline, Document, Event, Expense, Reminder, ShoppingItem, Task, Warranty } from "@/db/schema";
import { addDays, diffDays, fmtBR, relDay, todayIn } from "../dates";
import { brl } from "../money";
import { occursOn } from "../recurrence";

export type Alert = { key: string; kind: string; icon: string; text: string; level: "info" | "warn" | "bad"; weight: number };

export function computeAlerts(input: {
  today: string; tz: string;
  events: Event[]; bills: Expense[]; tasks: Task[]; shopping: ShoppingItem[]; reminders: Reminder[];
  docs?: Document[]; warranties?: Warranty[];
  invoices?: { cardId: string; cardName: string; dueDate: string; totalCents: number }[];
  deadlines?: Deadline[];
}): Alert[] {
  const { today, tz } = input;
  const out: Alert[] = [];
  const tomorrow = addDays(today, 1);

  for (const ev of input.events) {
    if (occursOn(ev, tomorrow)) {
      out.push({ key: `ev:${ev.id}:${tomorrow}`, kind: "event_tomorrow", icon: "🔔", level: "info", weight: 3,
        text: `Amanhã você tem ${ev.title.toLowerCase()}${ev.time ? ` às ${ev.time}` : ""}.` });
    }
    if (ev.remindDaysBefore && ev.remindDaysBefore > 1) {
      const target = addDays(today, ev.remindDaysBefore);
      if (occursOn(ev, target)) out.push({ key: `evr:${ev.id}:${target}`, kind: "event_soon", icon: "🔔", level: "info", weight: 3,
        text: `${ev.title} ${relDay(target, today).toLowerCase()}${ev.time ? ` às ${ev.time}` : ""}.` });
    }
  }

  for (const b of input.bills) {
    if (!b.dueDate) continue;
    const n = diffDays(today, b.dueDate);
    const v = b.amountCents ? ` (${brl(b.amountCents)})` : "";
    if (n < 0) out.push({ key: `bill:${b.id}`, kind: "bill_late", icon: "⚠️", level: "bad", weight: 6, text: `${b.description} venceu ${n === -1 ? "ontem" : `há ${-n} dias`}${v}.` });
    else if (n === 0) out.push({ key: `bill:${b.id}:0`, kind: "bill_due", icon: "⚠️", level: "bad", weight: 5, text: `${b.description} vence hoje${v}.` });
    else if (n <= 2) out.push({ key: `bill:${b.id}:${n}`, kind: "bill_due", icon: "⚠️", level: "warn", weight: 4, text: `${b.description} vence ${n === 1 ? "amanhã" : "em 2 dias"}${v}.` });
  }

  for (const f of input.invoices ?? []) {
    const n = diffDays(today, f.dueDate);
    const k = `inv:${f.cardId}:${f.dueDate}`;
    const v = ` (${brl(f.totalCents)})`;
    if (n < 0) out.push({ key: k, kind: "bill_late", icon: "💳", level: "bad", weight: 6, text: `A fatura do ${f.cardName} venceu ${n === -1 ? "ontem" : `há ${-n} dias`}${v}.` });
    else if (n === 0) out.push({ key: `${k}:0`, kind: "bill_due", icon: "💳", level: "bad", weight: 5, text: `A fatura do ${f.cardName} vence hoje${v}.` });
    else if (n <= 3) out.push({ key: `${k}:${n}`, kind: "bill_due", icon: "💳", level: "warn", weight: 4, text: `A fatura do ${f.cardName} vence ${n === 1 ? "amanhã" : `em ${n} dias`}${v}.` });
  }

  const late = input.tasks.filter((t) => t.dueDate && t.dueDate < today);
  if (late.length) out.push({ key: `late:${today}:${late.length}`, kind: "task_late", icon: "🔴", level: "bad", weight: 5,
    text: late.length === 1 ? `A tarefa "${late[0].title}" está atrasada.` : `${late.length} tarefas estão atrasadas.` });

  const stale = input.shopping.filter((i) => diffDays(todayIn(tz, i.createdAt), today) >= 5);
  if (stale.length) {
    const days = diffDays(todayIn(tz, stale[0].createdAt), today);
    out.push({ key: `shop:${stale.map((s) => s.id).sort().join(",").slice(0, 180)}`, kind: "shopping_stale", icon: "🛒", level: "warn", weight: 2,
      text: `Você colocou ${stale[0].name.toLowerCase()}${stale.length > 1 ? ` e mais ${stale.length - 1}` : ""} na lista de compras há ${days} dias.` });
  }

  for (const r of input.reminders) {
    if (r.date === today) out.push({ key: `rem:${r.id}`, kind: "reminder", icon: "🔔", level: "info", weight: 4, text: `${r.text}${r.time ? ` às ${r.time}` : ""}.` });
  }

  for (const d of input.docs ?? []) {
    if (!d.expiresAt) continue;
    const n = diffDays(today, d.expiresAt);
    if (n < 0 && n > -15) out.push({ key: `doc:${d.id}:late`, kind: "document_expired", icon: "📄", level: "bad", weight: 4, text: `${d.name} venceu em ${fmtBR(d.expiresAt)}.` });
    else if (n >= 0 && n <= 30) out.push({ key: `doc:${d.id}:${n <= 7 ? "7" : "30"}`, kind: "document_expiring", icon: "📄", level: "warn", weight: 3,
      text: `${d.name} vence ${n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`}.` });
  }
  for (const w of input.warranties ?? []) {
    const n = diffDays(today, w.expiresAt);
    if (n >= 0 && n <= 30) out.push({ key: `war:${w.id}`, kind: "warranty_expiring", icon: "🧾", level: "warn", weight: 2,
      text: `A garantia do ${w.item.toLowerCase()} vence ${n === 0 ? "hoje" : `em ${n} dias`} (${fmtBR(w.expiresAt)}).` });
  }

  for (const d of input.deadlines ?? []) {
    const n = diffDays(today, d.dueDate);
    if (n > d.remindDaysBefore) continue;
    // avisa em marcos (início da janela, 7 dias, véspera, no dia, atrasado) — cada marco uma vez só
    const bucket = n < 0 ? "late" : n === 0 ? "0" : n === 1 ? "1" : n <= 7 ? "7" : "start";
    const when = n < 0 ? `venceu em ${fmtBR(d.dueDate)}` : n === 0 ? "vence hoje" : n === 1 ? "vence amanhã" : `vence em ${n} dias (${fmtBR(d.dueDate)})`;
    out.push({ key: `dl:${d.id}:${d.dueDate}:${bucket}`, kind: n < 0 ? "deadline_late" : "deadline_soon", icon: "📌",
      level: n <= 0 ? "bad" : n <= 7 ? "warn" : "info", weight: n <= 0 ? 6 : n <= 7 ? 4 : 2, text: `${d.name} ${when}.` });
  }

  return out.sort((a, b) => b.weight - a.weight);
}
