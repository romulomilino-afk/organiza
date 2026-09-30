"use client";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/nina/types";
import { Composer } from "./Composer";
import { Bubble, Typing } from "./Messages";
import { useNina } from "./useNina";

export function ChatView({ initial, name, canVoice }: { initial: ChatMessage[]; name: string; canVoice: boolean }) {
  const { messages, busy, error, setError, send, answer } = useNina(initial);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, busy]);

  return (
    <>
      <div className="flex flex-col gap-3 pb-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="max-w-[86%] self-start rounded-[18px] rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-[15px]">
            <span className="mb-0.5 block text-xs font-bold text-accent">Nina</span>
            Oi{name ? `, ${name}` : ""}! Me conta o que você precisa lembrar, pagar ou comprar. Eu organizo. 😊
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} onAnswer={answer} />)}
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
