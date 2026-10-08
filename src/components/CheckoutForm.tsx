"use client";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/actions/billing";

/** Leva para a página segura do Asaas, onde a pessoa informa CPF, celular, endereço e o cartão. */
export function CheckoutForm({ plan, label }: { plan: "PREMIUM" | "FAMILY"; label: string; needsDocument?: boolean; phone?: string | null }) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn w-full" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="method" value="CREDIT_CARD" />
      <div className="rounded-2xl border border-accent bg-accent-soft px-3 py-2.5">
        <b className="block text-[15px]">💳 Cartão de crédito</b>
        <span className="text-[13px] text-ink-3">Cobrança automática todo mês. Você não precisa lembrar de pagar e pode cancelar quando quiser.</span>
      </div>
      <p className="text-[13px] text-ink-3">Na próxima tela, do Asaas, você informa seus dados (CPF, celular e endereço) e o cartão. Use o mesmo e-mail da sua conta.</p>
      {state?.error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="btn w-full">{pending ? "Abrindo pagamento…" : "Ir para o pagamento"}</button>
      <p className="text-center text-xs text-ink-3">🔒 Você digita o cartão na página segura do Asaas. O Meu Organiza não vê nem guarda os dados do cartão.</p>
    </form>
  );
}
