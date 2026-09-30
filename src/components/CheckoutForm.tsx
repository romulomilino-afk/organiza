"use client";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutState } from "@/actions/billing";

/** Pede CPF/CNPJ (exigência do Asaas para emitir a cobrança) e manda para a fatura. */
export function CheckoutForm({ plan, label, needsDocument }: { plan: "PREMIUM" | "FAMILY"; label: string; needsDocument: boolean }) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, undefined);
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn w-full" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      {needsDocument && (
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">CPF ou CNPJ
          <input name="doc" required inputMode="numeric" autoComplete="off" maxLength={18} placeholder="000.000.000-00" className="field font-normal" />
          <span className="font-normal text-ink-3">Usado só para emitir a cobrança no Asaas. Não fica guardado no Organiza.</span>
        </label>
      )}
      {state?.error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="btn w-full">{pending ? "Gerando fatura…" : "Ir para o pagamento"}</button>
      <p className="text-center text-xs text-ink-3">Você escolhe Pix, boleto ou cartão na próxima tela. Cancele quando quiser.</p>
    </form>
  );
}
