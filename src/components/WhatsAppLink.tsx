"use client";
import { useState } from "react";
import { generateWhatsAppCode } from "@/actions/whatsapp";

/** Gera o código de vínculo e mostra como mandar para o número do Organiza. */
export function WhatsAppLink({ number }: { number: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setError(null);
    const r = await generateWhatsAppCode();
    setBusy(false);
    if (r.error) setError(r.error); else setCode(r.code!);
  }
  const digits = number?.replace(/\D/g, "");
  return (
    <div className="flex flex-col gap-2">
      {!code ? (
        <button disabled={busy} onClick={go} className="btn w-fit">{busy ? "Gerando…" : "Conectar meu WhatsApp"}</button>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
          <p className="text-sm text-ink-2">Mande este código{number ? <> para <b className="select-all">{number}</b></> : " para o número do Organiza"} pelo WhatsApp. Vale por 15 minutos.</p>
          <div className="select-all font-display text-3xl font-bold tracking-[0.2em]">{code}</div>
          {digits && <a href={`https://wa.me/${digits}?text=${encodeURIComponent(`Meu código: ${code}`)}`} target="_blank" rel="noopener noreferrer" className="btn w-fit">Abrir o WhatsApp</a>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </div>
  );
}
