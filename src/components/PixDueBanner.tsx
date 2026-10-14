import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { pixDue } from "@/lib/billing";
import { PLANS } from "@/lib/plans";
import { brl } from "@/lib/money";
import { fmtBR } from "@/lib/dates";

/** Aviso de quem assina no Pix: o Pix do mês (ou da renovação anual) vence em breve ou já venceu. */
export async function PixDueBanner({ user }: { user: User }) {
  const d = await pixDue(getDb(), user).catch(() => null);
  if (!d) return null;
  const late = d.daysLeft < 0;
  const when = late ? `venceu em ${fmtBR(d.dueDate)}` : d.daysLeft === 0 ? "vence hoje" : d.daysLeft === 1 ? "vence amanhã" : `vence em ${fmtBR(d.dueDate)}`;
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] ${late ? "bg-bad-soft" : "bg-warn-soft"}`}>
      <span>⚡ <b>Pix do {PLANS[d.plan].name}{d.yearly ? " (anual)" : ""}</b> de {brl(d.valueCents, "BRL")} {when}.{late && " Pague para não perder os recursos do plano."}</span>
      <a href={d.url} target="_blank" rel="noopener noreferrer" className="shrink-0 font-semibold text-accent">Pagar</a>
    </div>
  );
}
