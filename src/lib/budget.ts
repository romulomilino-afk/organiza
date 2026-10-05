/**
 * "Posso gastar?" — quanto sobra no mês depois de tudo que já está comprometido.
 *
 * Receita do mês  = o que já entrou + receitas fixas que ainda vão cair este mês
 * Comprometido    = o que já saiu (inclui parcelas de cartão que vencem no mês)
 *                 + contas a pagar do mês + despesas fixas que ainda vão sair + assinaturas
 * Margem          = receita − comprometido
 * Livre p/ gastar = margem − folga (10% da receita, para imprevistos)
 */
import { and, eq, lte } from "drizzle-orm";
import type { DB } from "@/db";
import { expenses, recurringItems, subscriptions } from "@/db/schema";
import { addMonths, dateInMonth, diffDays, monthEnd, monthStart, todayIn } from "./dates";
import { monthFinance } from "./data/queries";
import { monthCardSpend } from "./cards";
import { brl } from "./money";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
export const CUSHION = 0.1;

export type Budget = Awaited<ReturnType<typeof monthBudget>>;

export async function monthBudget(db: DB, userId: string, today: string, tz = "America/Sao_Paulo") {
  const from = monthStart(today), to = monthEnd(today);
  const [fin, fixed, pend, subs] = await Promise.all([
    monthFinance(db, userId, today),
    db.select().from(recurringItems).where(and(eq(recurringItems.userId, userId), eq(recurringItems.active, true))),
    db.select().from(expenses).where(and(eq(expenses.userId, userId), eq(expenses.status, "PENDING"), lte(expenses.dueDate, to))), // inclui contas atrasadas
    db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.active, true))),
  ]);

  // fixos que ainda vão acontecer este mês (os que já passaram já estão lançados)
  const stillToCome = (kind: "INCOME" | "EXPENSE") => fixed.filter((f) => {
    if (f.kind !== kind || !f.amountCents) return false;
    const due = dateInMonth(today, f.dayOfMonth);
    return due > today && due >= todayIn(tz, f.createdAt) && (!f.generatedUntil || f.generatedUntil < due);
  }).reduce((a, f) => a + f.amountCents!, 0);
  const expectedIncomeCents = stillToCome("INCOME");
  const fixedToComeCents = stillToCome("EXPENSE");
  const pendingBillsCents = pend.reduce((a, b) => a + (b.amountCents ?? 0), 0);

  // assinaturas: só as que não estão já lançadas como fixo/despesa com o mesmo nome
  const known = [...fixed.map((f) => norm(f.name)), ...fin.expenses.map((e) => norm(e.description)), ...pend.map((p) => norm(p.description))];
  const subsMonthly = subs.filter((s) => !known.some((k) => k.includes(norm(s.name)) || norm(s.name).includes(k)));
  const subscriptionsCents = subsMonthly.reduce((a, s) => a + (s.cycle === "MONTHLY" ? s.amountCents : s.nextBilling && s.nextBilling >= from && s.nextBilling <= to ? s.amountCents : 0), 0);

  const incomeCents = fin.incomeCents + expectedIncomeCents;
  const committedCents = fin.expenseCents + pendingBillsCents + fixedToComeCents + subscriptionsCents;
  const marginCents = incomeCents - committedCents;
  const cushionCents = Math.round(incomeCents * CUSHION);
  const freeCents = Math.max(0, marginCents - cushionCents);
  const daysLeft = diffDays(today, to) + 1;

  // próximo mês: só o que é previsível (fixos, contas mensais, parcelas, assinaturas)
  const n1 = addMonths(from, 1);
  const card2 = await monthCardSpend(db, userId, n1, monthEnd(n1));
  const fixedIncome = fixed.filter((f) => f.kind === "INCOME").reduce((a, f) => a + (f.amountCents ?? 0), 0);
  const fixedOut = fixed.filter((f) => f.kind !== "INCOME").reduce((a, f) => a + (f.amountCents ?? 0), 0);
  const subsNext = subsMonthly.reduce((a, s) => a + (s.cycle === "MONTHLY" ? s.amountCents : 0), 0);
  const nextMargin = fixedIncome - fixedOut - card2.total - subsNext;

  return {
    month: from, today, daysLeft,
    receivedCents: fin.incomeCents, expectedIncomeCents, incomeCents,
    spentCents: fin.expenseCents, cardThisMonthCents: fin.cardCents, pendingBillsCents, fixedToComeCents, subscriptionsCents, committedCents,
    marginCents, cushionCents, freeCents, perDayCents: Math.floor(freeCents / daysLeft),
    hasIncome: incomeCents > 0 || fixedIncome > 0,
    next: { month: n1, incomeCents: fixedIncome, fixedOutCents: fixedOut, cardCents: card2.total, subscriptionsCents: subsNext, marginCents: nextMargin, cushionCents: Math.round(fixedIncome * CUSHION) },
  };
}

export type Verdict = "ok" | "apertado" | "nao";

/** Simula uma compra à vista ou parcelada. */
export function simulate(b: Budget, amountCents: number, installments = 1) {
  const n = Math.max(1, Math.min(48, installments));
  const each = Math.ceil(amountCents / n);
  const thisMonth = n > 1 ? each : amountCents;
  const after = b.marginCents - thisMonth;
  const nextAfter = n > 1 ? b.next.marginCents - each : null;
  const verdictOf = (a: number, cushion: number): Verdict => a >= cushion ? "ok" : a >= 0 ? "apertado" : "nao";
  const v1 = verdictOf(after, b.cushionCents);
  const v2 = nextAfter === null ? "ok" : verdictOf(nextAfter, b.next.cushionCents);
  const rank = { ok: 0, apertado: 1, nao: 2 } as const;
  const verdict: Verdict = rank[v1] >= rank[v2] ? v1 : v2;

  // se à vista não cabe, procura o menor parcelamento que cabe com folga
  let suggestion: number | null = null;
  if (verdict !== "ok" && n === 1) {
    for (let k = 2; k <= 12; k++) {
      const e = Math.ceil(amountCents / k);
      if (b.marginCents - e >= b.cushionCents && b.next.marginCents - e >= b.next.cushionCents) { suggestion = k; break; }
    }
  }
  return { n, each, thisMonth, before: b.marginCents, after, nextBefore: b.next.marginCents, nextAfter, verdict, suggestion };
}

/** Resposta em português, no tom da Nina. */
export function explainSimulation(b: Budget, amountCents: number, installments = 1): string {
  if (!b.hasIncome) return "Para eu responder isso, preciso saber sua renda. Diga, por exemplo: “meu salário de 4.000 cai todo dia 5”. 💡";
  const s = simulate(b, amountCents, installments);
  const what = s.n > 1 ? `${s.n}x de ${brl(s.each)}` : brl(amountCents);
  const mes = `de ${brl(s.before)} para ${brl(s.after)}`;
  const prox = s.nextAfter !== null ? ` No mês que vem, a margem prevista vai de ${brl(s.nextBefore)} para ${brl(s.nextAfter)}.` : "";
  if (s.verdict === "ok") return `Pode sim! Com ${what}, sua margem deste mês vai ${mes}, e ainda sobra a folga para imprevistos.${prox} ✅`;
  if (s.verdict === "apertado") return `Dá para comprar, mas fica apertado: com ${what}, sua margem deste mês vai ${mes}, abaixo da folga de ${brl(b.cushionCents)} que eu deixo para imprevistos.${prox}${s.suggestion ? ` Em ${s.suggestion}x de ${brl(Math.ceil(amountCents / s.suggestion))} fica mais tranquilo.` : ""} 🟡`;
  return `Agora eu não recomendo: com ${what}, sua margem deste mês iria ${mes}.${prox}${s.suggestion ? ` Em ${s.suggestion}x de ${brl(Math.ceil(amountCents / s.suggestion))} caberia.` : " Que tal esperar o próximo salário?"} 🔴`;
}

export function explainFree(b: Budget): string {
  if (!b.hasIncome) return "Para eu calcular, preciso saber sua renda. Diga, por exemplo: “meu salário de 4.000 cai todo dia 5”. 💡";
  if (b.marginCents < 0) return `Este mês está no vermelho: os compromissos passam a renda em ${brl(-b.marginCents)}. Melhor segurar os gastos até o próximo salário. 🔴`;
  return `Você pode gastar até ${brl(b.freeCents)} este mês sem se apertar — uns ${brl(b.perDayCents)} por dia nos próximos ${b.daysLeft} dias. Já descontei contas, fixos, parcelas e assinaturas, e deixei ${brl(b.cushionCents)} de folga para imprevistos. 💡`;
}
