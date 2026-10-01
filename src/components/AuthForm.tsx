"use client";
import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { IconEye, IconEyeOff } from "./icons";

/** Só aceita caminhos internos (evita redirecionar para outro site). */
function safeNext(u?: string) {
  return u && u.startsWith("/") && !u.startsWith("//") && !u.includes("\\") ? u : null;
}

function PasswordField({ name, label, autoComplete, hint, invalid }: { name: string; label: string; autoComplete: string; hint?: string; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">{label}
      <span className="relative">
        <input name={name} type={show ? "text" : "password"} required minLength={8} autoComplete={autoComplete}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={invalid || undefined}
          className={`field w-full pr-12 font-normal ${invalid ? "ring-2 ring-bad" : ""}`} />
        <button type="button" onClick={() => setShow((v) => !v)}
          aria-label={show ? "Esconder senha" : "Mostrar senha"} aria-pressed={show}
          className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-3 hover:text-ink">
          {show ? <IconEyeOff className="h-5 w-5" /> : <IconEye className="h-5 w-5" />}
        </button>
      </span>
      {hint && <span className="font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

export function AuthForm({ mode, googleEnabled, callbackUrl }: { mode: "login" | "cadastro"; googleEnabled: boolean; callbackUrl?: string }) {
  const next = safeNext(callbackUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? ""), password = String(fd.get("password") ?? "");
    if (mode === "cadastro" && password !== String(fd.get("confirm") ?? "")) {
      setMismatch(true); setError("As senhas não são iguais. Confira e tente de novo."); setBusy(false); return;
    }
    setMismatch(false);
    try {
      if (mode === "cadastro") {
        const res = await fetch("/api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fd.get("name"), email, password }) });
        if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Não consegui criar sua conta."); return; }
      }
      const r = await signIn("credentials", { email, password, redirect: false });
      if (!r || r.error) { setError("E-mail ou senha incorretos."); return; }
      window.location.href = next ?? (mode === "cadastro" ? "/onboarding" : "/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "cadastro" && (
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Seu nome
            <input name="name" required maxLength={80} autoComplete="given-name" className="field font-normal" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">E-mail
          <input name="email" type="email" required autoComplete="email" className="field font-normal" />
        </label>
        <PasswordField name="password" label="Senha" autoComplete={mode === "cadastro" ? "new-password" : "current-password"}
          hint={mode === "cadastro" ? "Pelo menos 8 caracteres." : undefined} />
        {mode === "cadastro" && (
          <PasswordField name="confirm" label="Confirme a senha" autoComplete="new-password" invalid={mismatch} />
        )}
        {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        <button disabled={busy} className="btn py-3.5 text-base">{busy ? "Aguarde…" : mode === "cadastro" ? "Criar conta" : "Entrar"}</button>
      </form>
      {googleEnabled && (
        <button onClick={() => signIn("google", { redirectTo: next ?? "/" })} className="btn btn-ghost py-3.5 text-base">Continuar com Google</button>
      )}
      <p className="text-center text-sm text-ink-2">
        {mode === "login" ? <>Ainda não tem conta? <Link href={next ? `/cadastro?callbackUrl=${encodeURIComponent(next)}` : "/cadastro"} className="font-semibold text-accent">Criar conta</Link></>
          : <>Já tem conta? <Link href={next ? `/login?callbackUrl=${encodeURIComponent(next)}` : "/login"} className="font-semibold text-accent">Entrar</Link></>}
      </p>
    </div>
  );
}
