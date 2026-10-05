import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { PLANS, type PlanId } from "@/lib/plans";
import { brl } from "@/lib/money";
import { fmtBR } from "@/lib/dates";
import { billingEnabled, currentBilling } from "@/lib/billing";
import { cancelAction } from "@/actions/billing";
import { CheckoutForm } from "@/components/CheckoutForm";
import { PageHeader } from "@/components/ui";

const FEATURES: Record<PlanId, string[]> = {
  FREE: ["50 conversas com a Nina por mês", "Agenda e lembretes", "Tarefas", "Lista de compras"],
  PREMIUM: ["Conversas praticamente ilimitadas", "Financeiro: gastos, contas e saldo", "Memória da Nina", "Falar por áudio", "Documentos, garantias e assinaturas", "Nina no WhatsApp"],
  FAMILY: ["Tudo do Premium", "Até 5 pessoas", "Agenda e tarefas compartilhadas", "Lista de compras da família", "Financeiro compartilhado (opcional)"],
};

export default async function PlanosPage({ searchParams }: { searchParams: Promise<{ pago?: string }> }) {
  const sp = await searchParams;
  const { user, access } = await requirePageAccess();
  const billing = await currentBilling(getDb(), user.id);
  const enabled = billingEnabled();
  const inherited = access.plan !== access.ownPlan;

  return (
    <>
      <PageHeader title="Planos" subtitle={`Seu plano: ${PLANS[access.plan].name}${inherited ? " (pela sua família)" : ""}`} />
      {sp.pago && billing?.status !== "ACTIVE" && (
        <p className="card mb-3 bg-accent-soft text-[15px]">✅ Pagamento enviado! Assim que o Asaas confirmar (normalmente em segundos), seu plano é ativado. Recarregue a página em instantes.</p>
      )}
      {user.currency !== "BRL" && <p className="mb-3 text-[13px] text-ink-3">Os planos são cobrados em reais (R$).</p>}
      {billing && (
        <div className="card mb-3 flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <b className="font-display text-lg">{PLANS[billing.plan as PlanId].name}</b>
            <span className={`pill ${billing.status === "ACTIVE" ? "pill-ok" : billing.status === "OVERDUE" ? "pill-bad" : "pill-warn"}`}>
              {{ ACTIVE: "Ativa", PENDING: "Aguardando pagamento", OVERDUE: "Pagamento atrasado", CANCELED: "Cancelada" }[billing.status]}
            </span>
          </div>
          <p className="text-sm text-ink-2">{billing.method === "CREDIT_CARD" ? "💳 Cobrança automática no cartão todo mês" : "Fatura mensal (Pix, boleto ou cartão)"}</p>
          {billing.currentPeriodEnd && <p className="text-sm text-ink-2">{billing.status === "ACTIVE" && billing.method === "CREDIT_CARD" ? `Próxima cobrança no cartão: ${fmtBR(billing.currentPeriodEnd)}.` : `Pago até ${fmtBR(billing.currentPeriodEnd)}.`}</p>}
          {billing.status !== "ACTIVE" && billing.lastInvoiceUrl && (
            <a href={billing.lastInvoiceUrl} target="_blank" rel="noopener noreferrer" className="btn w-fit">{billing.method === "CREDIT_CARD" && billing.status === "PENDING" ? "Concluir pagamento com cartão" : "Pagar"}</a>
          )}
          {billing.status === "OVERDUE" && <p className="text-sm text-bad">Pague em até 7 dias para não perder os recursos do plano.</p>}
          <form action={cancelAction}><button className="text-sm font-semibold text-ink-3 underline">Cancelar assinatura</button></form>
        </div>
      )}
      {!enabled && <p className="card mb-3 text-sm text-ink-2">Pagamentos ainda não configurados neste servidor (ASAAS_API_KEY).</p>}
      <div className="flex flex-col gap-3">
        {(["FREE", "PREMIUM", "FAMILY"] as const).map((p) => {
          const current = access.ownPlan === p;
          return (
            <div key={p} className={`card flex flex-col gap-3 ${current ? "border-accent" : ""}`}>
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">{PLANS[p].name}</h2>
                <span className="num font-display text-lg font-semibold">{PLANS[p].priceCents ? `${brl(PLANS[p].priceCents, "BRL")}/mês` : "Grátis"}</span>
              </div>
              <ul className="flex flex-col gap-1 text-[15px] text-ink-2">{FEATURES[p].map((f) => <li key={f}>✓ {f}</li>)}</ul>
              {current ? <span className="pill pill-ok w-fit">Seu plano</span>
                : p !== "FREE" && enabled && !(billing?.status === "ACTIVE" && billing.plan === p) && (
                  <CheckoutForm plan={p} label={`Assinar ${PLANS[p].name}`} needsDocument={!user.asaasCustomerId} />
                )}
            </div>
          );
        })}
      </div>
    </>
  );
}
