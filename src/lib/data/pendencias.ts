/**
 * Assistente de Pendências: junta TUDO que precisa de atenção hoje numa lista só, por cor.
 * 🔴 vencido / vence hoje · 🟡 fazer hoje / vence em breve · 🔵 compromissos de hoje · 🟢 está chegando (renovações, garantias)
 */
import type { DB } from "@/db";
import type { Access } from "../access";
import { addDays, diffDays, fmtBR } from "../dates";
import { brl } from "../money";
import { hasFeature } from "../plans";
import { occurrences, openReminders, openTasks, pendingBills, shoppingOpen, expiringItems } from "./queries";
import { cardsOverview } from "../cards";
import { activeRoutines, openDeadlines } from "../watch";

export type PendColor = "red" | "yellow" | "blue" | "green";
export type PendAction =
  | { kind: "task"; id: string }
  | { kind: "shop"; id: string }
  | { kind: "bill"; id: string }
  | { kind: "invoice"; cardId: string; dueDate: string }
  | { kind: "deadline"; id: string; renews: boolean }
  | { kind: "dismiss" }
  | { kind: "none" };
export type Pend = { key: string; color: PendColor; text: string; sub?: string; href?: string; action: PendAction; sort: string };

export const DOT: Record<PendColor, string> = { red: "🔴", yellow: "🟡", blue: "🔵", green: "🟢" };
const ORDER: Record<PendColor, number> = { red: 0, yellow: 1, blue: 2, green: 3 };
const em = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : `em ${n} dias`);

export async function buildPendencias(db: DB, a: Access, today: string, dismissed: (keys: string[]) => Promise<Set<string>>): Promise<Pend[]> {
  const fin = hasFeature(a.plan, "financeiro");
  const [occ, rems, tks, bills, shop, dls, routines, exp, cards] = await Promise.all([
    occurrences(db, a, today, today),
    openReminders(db, a.userId, addDays(today, -3), today),
    openTasks(db, a),
    fin ? pendingBills(db, a, addDays(today, 3)) : Promise.resolve([]),
    shoppingOpen(db, a),
    openDeadlines(db, a.userId, addDays(today, 120)),
    activeRoutines(db, a),
    expiringItems(db, a.userId, addDays(today, 30)),
    fin ? cardsOverview(db, a.userId, today) : Promise.resolve([]),
  ]);
  const out: Pend[] = [];

  // 🔴/🟡 tarefas
  const late = tks.filter((t) => t.dueDate && t.dueDate < today);
  for (const t of late.slice(0, 4)) out.push({ key: `t:${t.id}`, color: "red", text: t.title, sub: `Atrasada desde ${fmtBR(t.dueDate!)}`, action: { kind: "task", id: t.id }, sort: t.dueDate! });
  if (late.length > 4) out.push({ key: `tl:${today}`, color: "red", text: `+ ${late.length - 4} tarefas atrasadas`, href: "/agenda?tab=tarefas", action: { kind: "none" }, sort: "0" });
  for (const t of tks.filter((x) => x.dueDate === today)) out.push({ key: `t:${t.id}`, color: "yellow", text: t.title, sub: "Tarefa de hoje", action: { kind: "task", id: t.id }, sort: "1" });

  // 🔴/🟡 contas e faturas
  for (const b of bills) {
    const n = diffDays(today, b.dueDate!);
    out.push({ key: `b:${b.id}`, color: n <= 0 ? "red" : "yellow", text: `${n < 0 ? "Conta vencida" : "Pagar"}: ${b.description}`,
      sub: `${b.amountCents ? brl(b.amountCents) + " · " : ""}${n < 0 ? `venceu ${fmtBR(b.dueDate!)}` : `vence ${em(n)}`}`, action: { kind: "bill", id: b.id }, sort: b.dueDate! });
  }
  for (const c of cards) {
    const inv = c.toPay;
    if (!inv) continue;
    const n = diffDays(today, inv.dueDate);
    if (n <= 5) {
      out.push({ key: `inv:${c.card.id}:${inv.dueDate}`, color: n <= 1 ? "red" : "yellow", text: `Vencimento do cartão ${c.card.name}`,
        sub: `${brl(inv.totalCents)} · ${n < 0 ? `venceu ${fmtBR(inv.dueDate)}` : `vence ${em(n)}`}`, href: "/financeiro/cartoes", action: { kind: "invoice", cardId: c.card.id, dueDate: inv.dueDate }, sort: inv.dueDate });
    }
    if (n <= 7) {
      for (const it of inv.items.filter((x) => x.of > 1).slice(0, 3)) {
        out.push({ key: `p:${it.purchaseId}:${it.number}`, color: "yellow", text: `Parcela ${it.number}/${it.of} do ${it.description.toLowerCase()}`,
          sub: `${brl(it.amountCents)} · fatura ${c.card.name}`, href: "/financeiro/cartoes", action: { kind: "dismiss" }, sort: inv.dueDate });
      }
    }
  }

  // vencimentos e renovações
  for (const d of dls) {
    const n = diffDays(today, d.dueDate);
    if (n > d.remindDaysBefore) continue;
    const verb = d.renewMonths ? "Renovar" : "Vence:";
    out.push({ key: `dl:${d.id}:${d.dueDate}`, color: n <= 0 ? "red" : n <= 7 ? "yellow" : "green",
      text: n < 0 ? `${d.name} venceu` : `${verb} ${d.renewMonths ? d.name.charAt(0).toLowerCase() + d.name.slice(1) : d.name} ${em(n)}`,
      sub: fmtBR(d.dueDate), href: "/pendencias", action: { kind: "deadline", id: d.id, renews: !!d.renewMonths }, sort: d.dueDate });
  }

  // 🟡 compras: itens de rotina que voltaram para a lista + resumo da lista
  const routineNames = new Set(routines.map((r) => r.name.toLowerCase()));
  const routineItems = shop.filter((i) => routineNames.has(i.name.toLowerCase()));
  for (const i of routineItems.slice(0, 3)) out.push({ key: `s:${i.id}`, color: "yellow", text: `Comprar ${i.name.toLowerCase()}`, sub: "Compra de rotina", action: { kind: "shop", id: i.id }, sort: "2" });
  const others = shop.length - Math.min(3, routineItems.length);
  if (others > 0) out.push({ key: `sl:${shop.length}`, color: "yellow", text: `${others} ${others === 1 ? "item" : "itens"} na lista de compras`, href: "/casa", action: { kind: "none" }, sort: "3" });

  // 🔵 compromissos e lembretes de hoje
  for (const o of occ) out.push({ key: `e:${o.event.id}`, color: "blue", text: `${o.event.title}${o.event.time ? ` às ${o.event.time.replace(":00", "h")}` : ""}`, href: "/agenda", action: { kind: "none" }, sort: o.event.time ?? "99" });
  for (const r of rems.filter((x) => x.date === today)) out.push({ key: `r:${r.id}`, color: "blue", text: `${r.text}${r.time ? ` às ${r.time.replace(":00", "h")}` : ""}`, sub: "Lembrete", action: { kind: "dismiss" }, sort: r.time ?? "99" });

  // 🟢 garantias e documentos chegando
  if (hasFeature(a.plan, "garantias")) {
    for (const w of exp.wars) {
      const n = diffDays(today, w.expiresAt);
      if (n < 0) continue;
      out.push({ key: `w:${w.id}`, color: n <= 7 ? "yellow" : "green", text: `Garantia do ${w.item.toLowerCase()} acaba ${em(n)}`, sub: fmtBR(w.expiresAt), href: "/casa?tab=garantias", action: { kind: "dismiss" }, sort: w.expiresAt });
    }
  }
  for (const d of exp.docs) {
    const n = diffDays(today, d.expiresAt!);
    if (n < -15) continue;
    out.push({ key: `d:${d.id}`, color: n <= 0 ? "red" : n <= 7 ? "yellow" : "green", text: n < 0 ? `${d.name} venceu` : `${d.name} vence ${em(n)}`, sub: fmtBR(d.expiresAt!), href: "/casa?tab=documentos", action: { kind: "dismiss" }, sort: d.expiresAt! });
  }

  const hidden = await dismissed(out.filter((p) => p.action.kind === "dismiss" || p.action.kind === "deadline").map((p) => p.key));
  return out.filter((p) => !hidden.has(p.key)).sort((x, y) => ORDER[x.color] - ORDER[y.color] || x.sort.localeCompare(y.sort));
}
