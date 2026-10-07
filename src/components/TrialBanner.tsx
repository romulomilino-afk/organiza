import Link from "next/link";
import type { Access } from "@/lib/access";
import { PLANS } from "@/lib/plans";
import { brl } from "@/lib/money";
import { fmtBR } from "@/lib/dates";

/** Faixa do teste grátis: quantos dias faltam, ou o convite para assinar quando acabou. */
export function TrialBanner({ access, timezone }: { access: Access; timezone: string }) {
  const t = access.trial;
  if (!t || access.plan !== access.ownPlan) return null; // quem usa pelo plano da família não vê
  if (t.active) {
    const last = t.daysLeft <= 2;
    const end = fmtBR(t.endsAt.toLocaleDateString("en-CA", { timeZone: timezone }));
    return (
      <Link href="/planos" className={`mb-4 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] ${last ? "bg-warn-soft text-ink" : "bg-accent-soft text-ink"}`}>
        <span>🎁 <b>Teste grátis:</b> tudo liberado {t.daysLeft <= 1 ? "até hoje" : `por mais ${t.daysLeft} dias`} <span className="text-ink-3">(até {end})</span></span>
        <span className="shrink-0 font-semibold text-accent">Assinar</span>
      </Link>
    );
  }
  if (access.plan !== "FREE") return null;
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-[14px]">
      <p><b>Seu teste grátis acabou.</b> O financeiro, os cartões, o áudio, os documentos e a Nina no WhatsApp estão bloqueados. Seus dados continuam guardados.</p>
      <Link href="/planos" className="btn w-fit text-[14px]">Assinar a partir de {brl(PLANS.PREMIUM.priceCents, "BRL")}/mês</Link>
    </div>
  );
}
