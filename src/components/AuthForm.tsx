"use client";
import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";

/** Só aceita caminhos internos (evita redirecionar para outro site). */
function safeNext(u?: string) {
  return u && u.startsWith("/") && !u.startsWith("//") && !u.includes("\\") ? u : null;
}

export function AuthForm({ mode, googleEnabled, callbackUrl }: { mode: "login" | "cadastro"; googleEnabled: boolean; callbackUrl?: string }) {
  const next = safeNext(callbackUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? ""), password = String(fd.get("password") ?? "");
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
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Senha
          <input name="password" type="password" required minLength={8} autoComplete={mode === "cadastro" ? "new-password" : "current-password"} className="field font-normal" />
          {mode === "cadastro" && <span className="font-normal text-ink-3">Pelo menos 8 caracteres.</span>}
        </label>
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
