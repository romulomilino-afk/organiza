"use client";
import type { ChatMessage } from "@/lib/nina/types";

export function Typing() {
  return <span className="typing" aria-label="Nina está escrevendo"><i /><i /><i /></span>;
}

/** Resposta da Nina com cartões de confirmação e botões de sugestão. */
export function NinaReply({ m, onAnswer, compact = false }: { m: ChatMessage; onAnswer: (id: string, yes: boolean) => void; compact?: boolean }) {
  return (
    <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
      {!compact && <span className="mb-0.5 block text-xs font-bold text-accent">Nina</span>}
      {m.content}
      {m.cards.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {m.cards.map((c, i) => (
            <div key={i} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <b className="block font-display text-[15px] font-semibold">{c.icon} {c.title}</b>
              {c.lines.map((l, j) => <span key={j} className="block text-ink-2">{l}</span>)}
            </div>
          ))}
        </div>
      )}
      {m.suggestion && (
        <div className="mt-2.5">
          <p className="mb-2 text-[15px]">{m.suggestion.text}</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn px-3 py-1.5 text-sm" onClick={() => onAnswer(m.id, true)}>{m.suggestion.yes}</button>
            <button className="btn btn-ghost px-3 py-1.5 text-sm" onClick={() => onAnswer(m.id, false)}>{m.suggestion.no}</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Bubble({ m, onAnswer }: { m: ChatMessage; onAnswer: (id: string, yes: boolean) => void }) {
  if (m.role === "USER") {
    return <div className="max-w-[86%] self-end whitespace-pre-wrap rounded-[18px] rounded-br-md bg-accent px-3.5 py-2.5 text-[15px] text-accent-ink [overflow-wrap:anywhere]">{m.content}</div>;
  }
  return (
    <div className="max-w-[86%] self-start rounded-[18px] rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-[15px]">
      <NinaReply m={m} onAnswer={onAnswer} />
    </div>
  );
}
