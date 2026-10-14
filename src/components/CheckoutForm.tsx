"use client";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/actions/billing";

type Method = "CREDIT_CARD" | "PIX" | "PIX_YEARLY";

/**
 * Escolha da forma de pagamento e ida para a página segura do Asaas.
 * Cartão: o cliente informa CPF, celular, endereço e cartão lá. Pix: pedimos nome e CPF aqui (o Asaas exige) e o
 * cliente paga pelo QR Code ou copia e cola. O CPF vai direto para o Asaas; o Meu Organiza não guarda.
 */
export function CheckoutForm({ plan, label, monthly, yearly, yearlyPerMonth, name }: {
  plan: "PREMIUM" | "FAMILY"; label: string; monthly: string; yearly: string; yearlyPerMonth: string; name?: string | null;
}) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, undefined);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("CREDIT_CARD");
  if (!open) return <button className="btn w-full" onClick={() => setOpen(true)}>{label}</button>;

  const opts: { id: Method; title: string; price: string; text: string; tag?: string }[] = [
    { id: "CREDIT_CARD", title: "💳 Cartão de crédito", price: `${monthly}/mês`, text: "Cobrança automática todo mês. Você não precisa lembrar de pagar." },
    { id: "PIX", title: "⚡ Pix mensal", price: `${monthly}/mês`, text: "Todo mês chega um Pix para pagar (QR Code ou copia e cola). O app avisa antes de vencer." },
    { id: "PIX_YEARLY", title: "🎁 Pix anual", price: `${yearly}/ano`, text: `Paga uma vez e fica tranquilo o ano todo. Sai por ${yearlyPerMonth}/mês.`, tag: "10% off" },
  ];
  const pix = method !== "CREDIT_CARD";

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="method" value={method} />
      <div role="radiogroup" aria-label="Forma de pagamento" className="flex flex-col gap-2">
        {opts.map((o) => {
          const on = method === o.id;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setMethod(o.id)}
              className={`rounded-2xl border px-3 py-2.5 text-left transition ${on ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
              <span className="flex items-baseline justify-between gap-2">
                <b className="text-[15px]">{o.title}{o.tag && <span className="ml-2 rounded-full bg-[#F2C75C] px-2 py-0.5 text-[11px] font-bold text-[#0F2A22]">{o.tag}</span>}</b>
                <span className="num whitespace-nowrap text-[14px] font-semibold">{o.price}</span>
              </span>
              <span className="mt-0.5 block text-[13px] text-ink-3">{o.text}</span>
            </button>
          );
        })}
      </div>

      {pix ? (
        <div className="mt-1 flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">Nome completo
            <input name="name" required minLength={3} maxLength={120} defaultValue={name ?? ""} autoComplete="name" className="field font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">CPF
            <input name="doc" required inputMode="numeric" maxLength={18} placeholder="000.000.000-00" autoComplete="off" className="field font-normal" />
          </label>
          <p className="text-[12px] text-ink-3">O Asaas pede nome e CPF para gerar o Pix. O CPF vai direto para o Asaas; o Meu Organiza não guarda.</p>
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">Na próxima tela, do Asaas, você informa seus dados (CPF, celular e endereço) e o cartão. Use o mesmo e-mail da sua conta.</p>
      )}

      {state?.error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="btn w-full">{pending ? "Abrindo pagamento…" : pix ? "Gerar o Pix" : "Ir para o pagamento"}</button>
      <p className="text-center text-xs text-ink-3">🔒 {pix ? "Você paga na página segura do Asaas, pelo app do seu banco. Cancele quando quiser." : "Você digita o cartão na página segura do Asaas. O Meu Organiza não vê nem guarda os dados do cartão."}</p>
    </form>
  );
}
