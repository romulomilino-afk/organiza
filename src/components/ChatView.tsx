"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import type { ChatMessage } from "@/lib/nina/types";
import { Composer } from "./Composer";
import { Bubble, Typing } from "./Messages";
import { useNina } from "./useNina";

/** Primeiras ideias para quem acabou de chegar. A de salário mostra o que o Premium faz. */
const STARTERS = [
  "Meu salário de 1.800 cai todo dia 5",
  "Me lembra de pagar a luz dia 10",
  "Coloca arroz, café e detergente na lista de compras",
  "Tenho dentista quinta às 15h",
];
/** Depois de quantas mensagens a Nina convida para o teste grátis. */
const INVITE_AFTER = 5;

function TrialInvite() {
  return (
    <div className="self-stretch rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3.5">
      <p className="text-[15px] font-semibold">🎁 Gostou da Nina? Teste o Premium 7 dias grátis</p>
      <p className="mt-1 text-[14px] text-ink-2">Libera o financeiro completo: salário, gastos por categoria, contas, cartões, vales e o “Posso gastar?”. A 1ª cobrança só acontece no 8º dia, e você cancela quando quiser.</p>
      <Link href="/planos?bemvindo=1" className="btn mt-3 flex w-full justify-center">Testar grátis por 7 dias</Link>
    </div>
  );
}

export function ChatView({ initial, name, canVoice, invite = false }: { initial: ChatMessage[]; name: string; canVoice: boolean; invite?: boolean }) {
  const { messages, busy, error, setError, send, answer } = useNina(initial);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, busy]);
  // convite: depois de algumas mensagens, ou logo que a pessoa pede algo do Premium
  const userMsgs = messages.filter((m) => m.role === "USER").length;
  const lastNina = [...messages].reverse().find((m) => m.role === "ASSISTANT");
  const showInvite = invite && !busy && (userMsgs >= INVITE_AFTER || !!lastNina?.content.includes("plano Premium"));

  return (
    <>
      <div className="flex flex-col gap-3 pb-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="max-w-[86%] self-start rounded-[18px] rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-[15px]">
            <span className="mb-0.5 block text-xs font-bold text-accent">Nina</span>
            Oi{name ? `, ${name}` : ""}! Me conta o que você precisa lembrar, pagar ou comprar. Eu organizo. 😊
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-2" aria-label="Sugestões para começar">
            <span className="text-[13px] font-semibold text-ink-3">Experimente falar:</span>
            {STARTERS.map((t) => (
              <button key={t} type="button" disabled={busy} onClick={() => send(t)}
                className="rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[14px] text-ink shadow-sm active:scale-[.98]">“{t}”</button>
            ))}
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} onAnswer={answer} />)}
        {showInvite && <TrialInvite />}
        {busy && <div className="self-start rounded-[18px] rounded-bl-md border border-line bg-surface px-3.5 py-3"><Typing /></div>}
        {error && <p role="alert" className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{error}</p>}
        <div ref={end} className="h-24" />
      </div>
      <div className="fixed inset-x-0 z-10 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-3 pb-2.5" style={{ bottom: "calc(62px + env(safe-area-inset-bottom, 0px))" }}>
        <div className="mx-auto max-w-[528px]">
          <Composer busy={busy} canVoice={canVoice} onSend={send} onError={setError} />
        </div>
      </div>
    </>
  );
}
