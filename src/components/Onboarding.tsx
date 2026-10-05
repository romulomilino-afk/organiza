"use client";
import { useState, useTransition } from "react";
import { completeOnboarding } from "@/actions/items";
import { IconCheck } from "./icons";

const OPTS = [["agenda", "Minha agenda"], ["tarefas", "Minhas tarefas"], ["dinheiro", "Meu dinheiro"], ["casa", "Minha casa"], ["familia", "Minha família"], ["tudo", "Tudo"]] as const;
const ALL = OPTS.map((o) => o[0]);

export function Onboarding({ initialName }: { initialName: string }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [focus, setFocus] = useState<string[]>([]);
  const [currency, setCurrency] = useState<"BRL" | "USD" | "EUR">("BRL");
  const [pending, start] = useTransition();

  const toggle = (k: string) => {
    if (k === "tudo") return setFocus(focus.includes("tudo") ? [] : [...ALL]);
    setFocus(focus.includes(k) ? focus.filter((x) => x !== k && x !== "tudo") : [...focus, k]);
  };
  const finish = () => start(async () => { await completeOnboarding({ name: name.trim(), focus, currency }); window.location.href = "/"; });

  const dots = (
    <div className="flex gap-1.5" aria-label={`Passo ${step} de 3`}>
      {[1, 2, 3].map((i) => <i key={i} className={`h-1 w-6 rounded ${i <= step ? "bg-accent" : "bg-line"}`} />)}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      {step === 0 && (<>
        <div className="flex items-center gap-2 font-display text-[15px] font-bold tracking-wide text-accent">
          <span className="relative inline-block h-[22px] w-[22px] rounded-[7px] bg-accent after:absolute after:inset-[6px] after:rounded-full after:bg-glow" />Organiza
        </div>
        <h1 className="text-[40px] font-bold leading-[1.05]">Bem-vindo ao Organiza</h1>
        <p className="max-w-[32ch] text-lg text-ink-2">Sua vida é cheia de coisas para lembrar. Deixa isso comigo.</p>
        <button className="btn rounded-2xl py-4 text-[17px]" onClick={() => setStep(1)}>Começar</button>
      </>)}

      {step === 1 && (<>
        {dots}
        <h1 className="text-[32px] font-bold leading-tight">Como posso te chamar?</h1>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Seu nome" autoComplete="given-name"
          className="field rounded-2xl px-5 py-4 text-xl" onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) setStep(2); }} />
        <div>
          <p className="mb-2 text-[15px] font-semibold text-ink-2">Em qual moeda a Nina vai anotar seus gastos e receitas?</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Moeda">
            {([["BRL", "🇧🇷", "Real"], ["USD", "🇺🇸", "Dólar"], ["EUR", "🇪🇺", "Euro"]] as const).map(([k, f, n]) => (
              <button key={k} type="button" role="radio" aria-checked={currency === k} onClick={() => setCurrency(k)}
                className={`rounded-2xl border px-2 py-3 text-center ${currency === k ? "border-accent bg-accent-soft font-semibold" : "border-line"}`}>
                <span className="block text-2xl">{f}</span><span className="text-sm">{n}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-ink-3">Dá para trocar depois em Minha conta ou falando com a Nina.</p>
        </div>
        <button className="btn rounded-2xl py-4 text-[17px]" disabled={!name.trim()} onClick={() => setStep(2)}>Continuar</button>
      </>)}

      {step === 2 && (<>
        {dots}
        <h1 className="text-[32px] font-bold leading-tight">O que você mais quer organizar?</h1>
        <div className="grid gap-2.5">
          {OPTS.map(([k, l]) => {
            const on = focus.includes(k);
            return (
              <button key={k} onClick={() => toggle(k)} aria-pressed={on}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[17px] font-medium ${on ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
                <span className={`grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>{on && <IconCheck className="h-3 w-3" />}</span>
                {l}
              </button>
            );
          })}
        </div>
        <button className="btn rounded-2xl py-4 text-[17px]" onClick={() => setStep(3)}>Continuar</button>
      </>)}

      {step === 3 && (<>
        {dots}
        <h1 className="text-[32px] font-bold leading-tight">Você não precisa preencher tudo. Basta falar comigo.</h1>
        {[
          ["“Comprei um tênis hoje por R$ 350 no cartão.”", "🛍️ Compras · R$ 350 · Cartão · Despesa"],
          ["“Tenho dentista dia 20 às 14h.”", "📅 Dentista · dia 20 · 14:00"],
          ["“Estou sem arroz, leite e café.”", "🛒 Lista de compras com 3 itens"],
        ].map(([q, a]) => (
          <div key={q} className="card flex flex-col gap-2"><span>{q}</span><span className="text-sm font-semibold text-accent">→ {a}</span></div>
        ))}
        <button className="btn rounded-2xl py-4 text-[17px]" disabled={pending} onClick={finish}>{pending ? "Preparando…" : "Falar com a Nina"}</button>
      </>)}
    </main>
  );
}
