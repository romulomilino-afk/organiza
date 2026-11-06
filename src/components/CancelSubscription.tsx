"use client";
import { useState, useTransition } from "react";
import { cancelAction } from "@/actions/billing";

/** Cancelar assinatura com confirmação: explica até quando o acesso continua. */
export function CancelSubscription({ planName, until, pendingOnly, pix = false, trialUntil = null }: { planName: string; until: string | null; pendingOnly: boolean; pix?: boolean; trialUntil?: string | null }) {
  const [ask, setAsk] = useState(false);
  const [busy, start] = useTransition();
  if (!ask) return <button type="button" onClick={() => setAsk(true)} className="btn btn-ghost w-full">{pendingOnly ? "Desistir deste pagamento" : trialUntil ? "Cancelar teste (sem cobrança)" : "Cancelar assinatura"}</button>;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-bad-soft p-3">
      <p className="text-[15px] font-semibold">{pendingOnly ? "Desistir deste pagamento?" : `Cancelar o ${planName}?`}</p>
      <p className="text-sm text-ink-2">
        {trialUntil
          ? `Você está no teste grátis: cancelando agora, nada será cobrado no cartão. Você continua usando o ${planName} até ${trialUntil}.`
          : pendingOnly
          ? pix ? "Nada foi pago ainda. O Pix gerado deixa de valer." : "Nada foi cobrado ainda. O link de pagamento deixa de valer."
          : `${pix ? "Não chegarão novas cobranças de Pix." : "Não haverá novas cobranças no cartão."} ${until ? `Você continua com o ${planName} até ${until}` : "O plano termina agora"} e depois a conta volta para o Grátis. Seus dados continuam guardados.`}
      </p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => start(() => cancelAction())} className="btn flex-1" style={{ background: "var(--bad)", color: "#fff" }}>{busy ? "Cancelando…" : "Sim, cancelar"}</button>
        <button type="button" disabled={busy} onClick={() => setAsk(false)} className="btn btn-ghost flex-1">Voltar</button>
      </div>
    </div>
  );
}
