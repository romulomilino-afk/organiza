"use client";
import { useActionState, useState } from "react";
import { moveReserveAction, type ReserveState } from "@/actions/months";

/** Guardar ou retirar dinheiro da reserva. */
export function ReserveForm({ hasBalance }: { hasBalance: boolean }) {
  const [state, action, pending] = useActionState<ReserveState, FormData>(moveReserveAction, undefined);
  const [kind, setKind] = useState<"IN" | "OUT">("IN");
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Tipo">
        <button type="button" role="radio" aria-checked={kind === "IN"} onClick={() => setKind("IN")} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${kind === "IN" ? "bg-surface shadow-sm" : "text-ink-3"}`}>Guardar</button>
        <button type="button" role="radio" aria-checked={kind === "OUT"} disabled={!hasBalance} onClick={() => setKind("OUT")} className={`flex-1 rounded-lg py-1.5 text-sm font-semibold disabled:opacity-40 ${kind === "OUT" ? "bg-surface shadow-sm" : "text-ink-3"}`}>Retirar</button>
      </div>
      <input type="hidden" name="kind" value={kind} />
      <div className="flex gap-2">
        <input name="valor" required inputMode="decimal" pattern="[0-9.,]+" placeholder="Valor" aria-label="Valor" className="field min-w-0 flex-1 py-2.5" />
        <button disabled={pending} className="btn">{pending ? "…" : kind === "IN" ? "Guardar" : "Retirar"}</button>
      </div>
      {kind === "OUT" && <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="toMonth" defaultChecked className="h-4 w-4" /> Somar como receita neste mês</label>}
      {state?.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state?.ok && <p className="text-sm text-good">{state.ok}</p>}
    </form>
  );
}
