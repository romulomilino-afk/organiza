"use client";
import { useActionState, useState } from "react";
import { createFamilyAction, inviteAction, type FamilyState } from "@/actions/family";

export function CreateFamilyForm() {
  const [state, action, pending] = useActionState<FamilyState, FormData>(createFamilyAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input name="name" required maxLength={60} placeholder="Nome da família (ex.: Família Silva)" aria-label="Nome da família" className="field" />
      {state?.error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button disabled={pending} className="btn">{pending ? "Criando…" : "Criar família"}</button>
    </form>
  );
}

export function InviteButton() {
  const [state, setState] = useState<FamilyState>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  async function go() { setBusy(true); setCopied(false); setState(await inviteAction()); setBusy(false); }
  async function copy(link: string) {
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }
  async function share(link: string) {
    if (navigator.share) await navigator.share({ title: "Meu Organiza", text: "Entre na nossa família no Meu Organiza:", url: link }).catch(() => {});
    else copy(link);
  }
  return (
    <div className="flex flex-col gap-2">
      <button disabled={busy} onClick={go} className="btn w-fit">{busy ? "Gerando…" : "Convidar alguém"}</button>
      {state?.error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state?.link && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
          <p className="text-sm text-ink-2">Envie este link para a pessoa. Vale por 7 dias e só pode ser usado uma vez.</p>
          <code className="select-all break-all text-[13px]">{state.link}</code>
          <div className="flex gap-2">
            <button onClick={() => share(state.link!)} className="btn px-3 py-1.5 text-sm">Compartilhar</button>
            <button onClick={() => copy(state.link!)} className="btn btn-ghost px-3 py-1.5 text-sm">{copied ? "Copiado ✓" : "Copiar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
