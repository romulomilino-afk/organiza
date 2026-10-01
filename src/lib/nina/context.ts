import type { DB } from "@/db";
import type { User } from "@/db/schema";
import { addDays, DIAS, nowTimeIn, weekday } from "../dates";
import { PLANS } from "../plans";
import {
  activeSubscriptions, fixedItems, memories, monthFinance, occurrences, openReminders, openTasks, pendingBills, shoppingOpen,
} from "../data/queries";
import { and, eq } from "drizzle-orm";
import { events, householdMembers, users } from "@/db/schema";
import { visible, type Access } from "../access";

/**
 * Tudo que a Nina precisa saber para interpretar a mensagem — só do próprio usuário.
 * Enxuto de propósito: ids + campos essenciais (custo e privacidade).
 */
export async function buildContext(db: DB, user: User, access: Access, today: string) {
  const calendario: string[] = [];
  for (let i = -1; i <= 14; i++) {
    const d = addDays(today, i);
    calendario.push(`${d} = ${DIAS[weekday(d)]}${i === 0 ? " (HOJE)" : i === 1 ? " (amanhã)" : ""}`);
  }
  const [occ, recurring, tks, bills, shop, rems, mems, subs, fin, fixos] = await Promise.all([
    occurrences(db, access, addDays(today, -1), addDays(today, 45)),
    db.select().from(events).where(and(visible(events, access), eq(events.cancelled, false))).limit(300),
    openTasks(db, access),
    pendingBills(db, access, addDays(today, 60)),
    shoppingOpen(db, access),
    openReminders(db, user.id, addDays(today, -7), addDays(today, 90)),
    memories(db, user.id),
    activeSubscriptions(db, user.id),
    monthFinance(db, user.id, today),
    fixedItems(db, user.id),
  ]);

  const seen = new Set<string>();
  const compromissos = occ.filter((o) => { const k = `${o.event.id}:${o.day}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 60).map((o) => ({ id: o.event.id, title: o.event.title, date: o.day, time: o.event.time, recorrente: o.event.recurrence !== "NONE", familia: !!o.event.householdId }));
  const rotinas = recurring.filter((e) => e.recurrence !== "NONE").map((e) => ({ id: e.id, title: e.title, recurrence: e.recurrence, desde: e.date, time: e.time }));

  const plan = PLANS[access.plan];
  let familia: { nome: string; membros: string[]; financeiro_compartilhado: boolean } | null = null;
  if (access.household?.active) {
    const members = await db.select({ name: users.name }).from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId)).where(eq(householdMembers.householdId, access.household.id));
    familia = { nome: access.household.name, membros: members.map((m) => m.name ?? "").filter(Boolean), financeiro_compartilhado: access.household.shareFinance };
  }
  return {
    hoje: today,
    dia_semana: DIAS[weekday(today)],
    hora_agora: nowTimeIn(user.timezone),
    calendario,
    usuario: { nome: user.name ?? "", plano: plan.name, recursos_do_plano: plan.features },
    familia,
    memoria: mems.map((m) => m.fact),
    compromissos,
    rotinas,
    tarefas_abertas: tks.slice(0, 60).map((t) => ({ id: t.id, title: t.title, due: t.dueDate, familia: !!t.householdId })),
    contas_a_pagar: bills.map((b) => ({ id: b.id, name: b.description, amount: b.amountCents != null ? b.amountCents / 100 : null, due: b.dueDate })),
    lista_de_compras: shop.map((i) => i.name),
    lembretes: rems.slice(0, 40).map((r) => ({ id: r.id, text: r.text, date: r.date, time: r.time })),
    fixos_do_mes: {
      itens: fixos.items.map((f) => ({ id: f.id, tipo: f.kind === "INCOME" ? "receita fixa" : f.kind === "EXPENSE" ? "despesa fixa (automática)" : "conta fixa (avisa para pagar)", name: f.name, amount: f.amountCents != null ? f.amountCents / 100 : null, dia: f.dayOfMonth, category: f.categoryKey })),
      total_receitas: fixos.incomeCents / 100,
      total_despesas: fixos.expenseCents / 100,
      sobra_prevista: fixos.leftoverCents / 100,
    },
    assinaturas: subs.map((s) => ({ id: s.id, name: s.name, amount: s.amountCents / 100, cycle: s.cycle })),
    financeiro_do_mes: {
      receitas: fin.incomeCents / 100,
      despesas: fin.expenseCents / 100,
      saldo: fin.balanceCents / 100,
      gastos_hoje: fin.todayCents / 100,
      por_categoria: Object.fromEntries(Object.entries(fin.byCategory).map(([k, v]) => [k, v / 100])),
      ultimos: fin.expenses.slice(0, 12).map((e) => ({ description: e.description, amount: (e.amountCents ?? 0) / 100, category: e.categoryKey, date: e.date })),
    },
  };
}

export type NinaContext = Awaited<ReturnType<typeof buildContext>>;
