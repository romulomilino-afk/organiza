"use client";
import Link from "next/link";
import { Composer } from "./Composer";
import { NinaReply, Typing } from "./Messages";
import { useNina } from "./useNina";

const EXAMPLES = ["Minha geladeira está fazendo um barulho estranho", "Meu seguro vence em dezembro", "Posso comprar um celular de R$ 1.500?", "Preciso comprar ração quando estiver acabando", "Gastei 45 reais no almoço", "Preciso marcar revisão do carro para semana que vem"];

/** Área principal da tela inicial: microfone, campo e a resposta da Nina logo abaixo. */
export function HomeNina({ canVoice }: { canVoice: boolean }) {
  const { messages, busy, error, setError, send, answer } = useNina();
  const last = [...messages].reverse().find((m) => m.role === "ASSISTANT");
  const showPeek = busy || last;

  return (
    <section className="flex flex-col items-center gap-3.5 pt-4 pb-2">
      <Composer variant="hero" busy={busy} canVoice={canVoice} onSend={send} onError={setError} placeholder="Ex.: meu seguro vence em dezembro" />
      {error && <p role="alert" className="w-full rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{error}</p>}
      {showPeek ? (
        <div className="w-full rounded-[18px] bg-accent-soft px-4 py-3.5 text-[15px]" aria-live="polite">
          {busy ? <><b className="font-display">Nina: </b><Typing /></> : last && (
            <>
              <NinaReply m={last} onAnswer={answer} />
              <Link href="/nina" className="mt-2 inline-block text-sm font-semibold text-accent">Ver conversa</Link>
            </>
          )}
        </div>
      ) : (
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {EXAMPLES.map((x) => (
            <button key={x} onClick={() => send(x)} className="flex-none rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-ink-2 hover:border-accent hover:text-ink">{x}</button>
          ))}
        </div>
      )}
    </section>
  );
}
