import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { listMembers } from "@/lib/family";
import { PLANS } from "@/lib/plans";
import { leaveFamilyAction, removeMemberAction, shareFinanceAction } from "@/actions/family";
import { CreateFamilyForm, InviteButton } from "@/components/FamilyForms";
import { PageHeader, XButton } from "@/components/ui";

export default async function FamiliaPage() {
  const { user, access } = await requirePageAccess();
  const hh = access.household;

  if (!hh) {
    return (
      <>
        <PageHeader title="Família" subtitle="Organizem a casa juntos" />
        <div className="card flex flex-col gap-3">
          <ul className="flex flex-col gap-1 text-[15px] text-ink-2">
            <li>👨‍👩‍👧 Até {PLANS.FAMILY.maxMembers} pessoas</li>
            <li>🛒 Uma lista de compras para todos</li>
            <li>📅 Agenda e tarefas da família</li>
            <li>💰 Gastos da casa compartilhados (se quiserem)</li>
          </ul>
          {access.ownPlan === "FAMILY" ? <CreateFamilyForm /> : (
            <>
              <p className="text-sm text-ink-2">Para criar uma família, assine o plano Família. Para entrar numa família, peça o link de convite a quem criou.</p>
              <Link href="/planos" className="btn w-fit">Ver plano Família</Link>
            </>
          )}
        </div>
      </>
    );
  }

  const members = await listMembers(getDb(), hh.id);
  const owner = hh.role === "OWNER";
  return (
    <>
      <PageHeader title={hh.name} subtitle={`${members.length} de ${PLANS.FAMILY.maxMembers} pessoas`} />
      {!hh.active && (
        <div className="card mb-3 text-sm text-bad">O plano Família de quem criou a família não está ativo. Enquanto isso, nada é compartilhado.</div>
      )}
      <div className="flex flex-col gap-3">
        <div className="card">
          <div className="eyebrow mb-1.5">Pessoas</div>
          {members.map((m) => (
            <div key={m.userId} className="row">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft font-display font-semibold text-accent">{(m.name ?? m.email)[0]?.toUpperCase()}</div>
              <div className="min-w-0 flex-1"><div className="font-medium">{m.name ?? m.email}{m.userId === user.id ? " (você)" : ""}</div><div className="text-[13px] text-ink-3">{m.role === "OWNER" ? "Criou a família" : "Membro"}</div></div>
              {owner && m.userId !== user.id && <XButton action={removeMemberAction.bind(null, m.userId)} label={`Remover ${m.name ?? m.email}`} />}
            </div>
          ))}
        </div>

        {owner && hh.active && members.length < PLANS.FAMILY.maxMembers && <div className="card"><InviteButton /></div>}

        <div className="card flex flex-col gap-2">
          <div className="eyebrow">O que é compartilhado</div>
          <p className="text-[15px] text-ink-2">🛒 Lista de compras: sempre. 📅 Compromissos e ✅ tarefas: quando você disser à Nina que é da família (“a gente tem…”, “coloca na agenda da família…”).</p>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div><div className="font-medium">Gastos da casa</div><div className="text-[13px] text-ink-3">{hh.shareFinance ? "Compartilhados: todos veem os gastos marcados como da casa." : "Cada um vê só os próprios gastos."}</div></div>
            {owner && (
              <form action={shareFinanceAction.bind(null, !hh.shareFinance)}>
                <button className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-sm">{hh.shareFinance ? "Desativar" : "Compartilhar"}</button>
              </form>
            )}
          </div>
        </div>

        <form action={leaveFamilyAction}>
          <button className="btn btn-ghost w-full text-bad">{owner ? "Apagar família" : "Sair da família"}</button>
        </form>
        {owner && <p className="-mt-1 text-center text-xs text-ink-3">Ao apagar, os itens compartilhados voltam a ser só de quem os criou.</p>}
      </div>
    </>
  );
}
