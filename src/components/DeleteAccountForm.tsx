"use client";
import { useActionState } from "react";
import { deleteAccountAction, type DeleteState } from "@/actions/account";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccountAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm text-ink-2">
        Para confirmar, digite <b className="text-ink">EXCLUIR</b>:
        <input name="confirm" autoComplete="off" required className="field py-2.5" aria-label="Digite EXCLUIR" />
      </label>
      {state?.error && <p className="text-sm text-bad" role="alert">{state.error}</p>}
      <button disabled={pending} className="btn w-full" style={{ background: "var(--bad)", color: "#fff" }}>
        {pending ? "Excluindo…" : "Excluir minha conta para sempre"}
      </button>
    </form>
  );
}
