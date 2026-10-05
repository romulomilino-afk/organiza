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
import { loadCategories } from "../data/user-categories";
import { cardsOverview } from "../cards";
import { activeRoutines, openDeadlines } from "../watch";
import { monthBudget } from "../budget";
import { getRates, rate } from "../fx";
import { CURRENCIES, isCurrency, type Currency } from "../money";
import { hasFeature } from "../plans";

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
  const [occ, recurring, tks, bills, shop, rems, mems, subs, fin, fixos, cats, cards, dls, routines] = await Promise.all([
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
    loadCategories(db, user.id),
    cardsOverview(db, user.id, today),
    openDeadlines(db, user.id),
    activeRoutines(db, access),
  ]);
  const budget = hasFeature(access.plan, "financeiro") ? await monthBudget(db, user.id, today, user.timezone) : null;
  const r2 = (c: number) => Math.round(c) / 100;
  const myCur: Currency = isCurrency(user.currency) ? user.currency : "BRL";
  const fx = await getRates(db, today);
  const cotacoes = fx ? Object.fromEntries((["BRL", "USD", "EUR"] as Currency[]).filter((c) => c !== myCur)
    .map((c) => [`1 ${c} em ${myCur}`, Math.round(rate(c, myCur, fx) * 10000) / 10000])) : null;
  const catOut = (c: { key: string; name: string; custom: boolean; keywords: string[] }) =>
    ({ key: c.key, name: c.name, ...(c.custom ? { criada_pelo_usuario: true } : {}), ...(c.keywords.length ? { palavras: c.keywords } : {}) });

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
    categorias: { despesa: cats.expense().map(catOut), receita: cats.income().map(catOut) },
    moeda_do_usuario: { codigo: myCur, simbolo: CURRENCIES[myCur].symbol, nome: CURRENCIES[myCur].name },
    cotacoes_hoje: cotacoes ? { ...cotacoes, data: fx!.day } : null,
    orcamento: budget ? {
      receita_do_mes: r2(budget.incomeCents), ja_recebido: r2(budget.receivedCents), receita_fixa_ainda_vai_cair: r2(budget.expectedIncomeCents),
      ja_gasto_inclui_parcelas: r2(budget.spentCents), contas_a_pagar_no_mes: r2(budget.pendingBillsCents), fixos_que_ainda_vao_sair: r2(budget.fixedToComeCents), assinaturas: r2(budget.subscriptionsCents),
      margem_do_mes: r2(budget.marginCents), folga_para_imprevistos: r2(budget.cushionCents), pode_gastar_sem_apertar: r2(budget.freeCents), por_dia: r2(budget.perDayCents), dias_restantes: budget.daysLeft,
      proximo_mes: { receita_fixa: r2(budget.next.incomeCents), fixos_e_contas: r2(budget.next.fixedOutCents), parcelas_cartao: r2(budget.next.cardCents), margem_prevista: r2(budget.next.marginCents) },
      tem_renda_cadastrada: budget.hasIncome,
    } : null,
    vencimentos: dls.slice(0, 40).map((d) => ({ id: d.id, name: d.name, vence: d.dueDate, avisar_dias_antes: d.remindDaysBefore, renova_meses: d.renewMonths })),
    compras_de_rotina: routines.map((r) => ({ item: r.name, a_cada_dias: r.everyDays, proxima: r.nextDate })),
    cartoes: cards.map((c) => ({
      nome: c.card.name, fecha_dia: c.card.closingDay, vence_dia: c.card.dueDay, melhor_dia_de_compra: c.best.day,
      hoje_e_bom_para_comprar: c.best.goodNow, limite: c.card.limitCents != null ? c.card.limitCents / 100 : null, limite_usado: c.usedCents / 100,
      fatura_a_pagar: c.toPay ? { vencimento: c.toPay.dueDate, total: c.toPay.totalCents / 100, status: c.toPay.status } : null,
      fatura_aberta: c.open ? { vencimento: c.open.dueDate, fecha_em: c.open.closingDate, total_ate_agora: c.open.totalCents / 100 } : null,
      proximas_faturas: c.upcoming.map((i) => ({ vencimento: i.dueDate, total: i.totalCents / 100 })),
      compras_parceladas: c.purchases.slice(0, 25).map((p) => ({ id: p.purchaseId, descricao: p.description, parcela_atual: `${p.next}/${p.of}`, valor_parcela: p.amountCents / 100, faltam: p.remaining, ultima_fatura: p.lastDue })),
    })),
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
