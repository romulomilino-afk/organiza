/**
 * Saúde financeira do mês: verde, amarelo ou vermelho.
 *
 * Usa a mesma conta do "Posso gastar?" (receita do mês − tudo que já está comprometido):
 *   🟢 Saudável    sobra pelo menos 10% da renda e não há contas ou faturas atrasadas
 *   🟡 Atenção     sobra menos de 10%, OU há conta/fatura atrasada, OU o mês que vem já está previsto no vermelho
 *   🔴 No vermelho os compromissos do mês passam a renda
 * Sem renda cadastrada não dá para avaliar (cinza).
 */
import { and, eq, lt } from "drizzle-orm";
import type { DB } from "@/db";
import { expenses } from "@/db/schema";
import { CUSHION, type Budget } from "./budget";
import { unpaidInvoicesDue } from "./cards";
import { brl } from "./money";

export type HealthLevel = "verde" | "amarelo" | "vermelho" | "sem_dados";
export type Health = { level: HealthLevel; label: string; position: number; percent: number | null; reasons: string[]; tip: string | null };

const LABEL: Record<HealthLevel, string> = { verde: "Saudável", amarelo: "Atenção", vermelho: "No vermelho", sem_dados: "Sem dados" };
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/** Regra pura (testável). `position` vai de 0 (bem no vermelho) a 1 (bem saudável), para o marcador da barra. */
export function financialHealth(b: Budget, o: { overdueBills: number; overdueInvoices: number; reserveCents?: number }): Health {
  if (!b.hasIncome || b.incomeCents <= 0) {
    return { level: "sem_dados", label: LABEL.sem_dados, position: 0.5, percent: null, reasons: ["Cadastre sua renda para ver a saúde do mês. Diga para a Nina: “meu salário de 4.000 cai todo dia 5”."], tip: null };
  }
  const r = b.marginCents / b.incomeCents;
  const percent = Math.round(r * 100);
  let level: HealthLevel = r < 0 ? "vermelho" : r < CUSHION ? "amarelo" : "verde";
  let position = r < 0 ? 0.32 * (1 - Math.min(1, -r / 0.3))
    : r < CUSHION ? 0.35 + (r / CUSHION) * 0.3
    : 0.68 + Math.min(1, (r - CUSHION) / 0.3) * 0.32;

  const reasons: string[] = [];
  if (level === "vermelho") reasons.push(`Os compromissos do mês passam a renda em ${brl(-b.marginCents)}.`);
  else if (level === "amarelo") reasons.push(`Sobram só ${brl(b.marginCents)} (${percent}% da renda). O ideal é sobrar pelo menos 10%.`);
  else reasons.push(`Sobram ${brl(b.marginCents)} (${percent}% da renda) depois de todas as contas do mês.`);

  const late = o.overdueBills + o.overdueInvoices;
  if (late > 0) {
    const parts = [o.overdueBills ? plural(o.overdueBills, "conta atrasada", "contas atrasadas") : "", o.overdueInvoices ? plural(o.overdueInvoices, "fatura de cartão atrasada", "faturas de cartão atrasadas") : ""].filter(Boolean);
    reasons.push(`Tem ${parts.join(" e ")}.`);
  }
  const nextRed = b.next.incomeCents > 0 && b.next.marginCents < 0;
  if (nextRed) reasons.push(`O mês que vem está previsto no vermelho (${brl(b.next.marginCents)}).`);
  if (level === "verde" && (late > 0 || nextRed)) { level = "amarelo"; position = Math.min(position, 0.62); }

  const reserve = o.reserveCents ?? 0;
  const tip = level === "vermelho"
    ? reserve > 0 ? `Você tem ${brl(reserve)} na reserva que pode ajudar a cobrir.` : "Segure os gastos que não são essenciais até o próximo salário."
    : late > 0 ? "Pague primeiro o que está atrasado para evitar juros."
    : level === "amarelo" ? "Veja na aba Meses onde o gasto mais subiu."
    : "Continue assim! Que tal guardar parte da sobra na reserva?";
  return { level, label: LABEL[level], position: Math.max(0.02, Math.min(0.98, position)), percent, reasons, tip };
}

/** Busca o que falta (atrasos) e calcula. */
export async function healthFor(db: DB, userId: string, today: string, b: Budget, reserveCents = 0): Promise<Health> {
  const [bills, invoices] = await Promise.all([
    db.select({ id: expenses.id }).from(expenses).where(and(eq(expenses.userId, userId), eq(expenses.status, "PENDING"), lt(expenses.dueDate, today))).limit(50),
    unpaidInvoicesDue(db, userId, today, today),
  ]);
  return financialHealth(b, { overdueBills: bills.length, overdueInvoices: invoices.filter((i) => i.status === "vencida").length, reserveCents });
}
