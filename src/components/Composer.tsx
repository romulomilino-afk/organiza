"use client";
import { useRef, useState } from "react";
import { IconMic, IconSend } from "./icons";
import { useVoice } from "./useVoice";

/**
 * Campo de conversa com microfone. `variant="hero"` = botão grande da tela inicial.
 */
export function Composer({ onSend, busy, variant = "bar", canVoice = true, onError, placeholder }: {
  onSend: (text: string, source: "TEXT" | "VOICE") => void;
  busy: boolean;
  variant?: "hero" | "bar";
  canVoice?: boolean;
  onError: (msg: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const voice = useVoice({
    onPartial: (t) => setText(t),
    onFinal: (t) => { setText(""); onSend(t, "VOICE"); },
    onError: (m) => { onError(m); inputRef.current?.focus(); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text, "TEXT");
    setText("");
  };
  const mic = () => {
    if (!canVoice) { onError("Falar por áudio faz parte do plano Premium. Você pode digitar ou usar o 🎤 do teclado."); inputRef.current?.focus(); return; }
    voice.start();
  };

  const form = (
    <form onSubmit={submit} className="flex w-full items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-4 pr-1.5 shadow-[0_8px_24px_-12px_rgba(20,40,34,.18)]">
      <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoComplete="off"
        aria-label="Escreva para a Nina" placeholder={placeholder ?? "Escreva para a Nina…"}
        className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-ink-3" />
      <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar"
        className="grid h-10 w-10 flex-none place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-40">
        <IconSend className="h-5 w-5" />
      </button>
    </form>
  );

  if (variant === "hero") {
    return (
      <div className="flex w-full flex-col items-center gap-3.5">
        <button onClick={mic} aria-label={voice.listening ? "Parar de ouvir" : "Fale comigo"}
          className={`mic-ring relative grid h-[132px] w-[132px] place-items-center rounded-full bg-accent text-accent-ink shadow-[0_14px_40px_-14px_var(--accent)] ${voice.listening ? "listening" : ""}`}>
          <IconMic className="h-12 w-12" />
        </button>
        <div className="font-display text-xl font-semibold">{voice.listening ? "Estou ouvindo…" : "Fale comigo"}</div>
        <p className="max-w-[36ch] text-center text-sm text-ink-3">Fale ou escreva do seu jeito. Eu organizo o resto.</p>
        {form}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button onClick={mic} aria-label={voice.listening ? "Parar de ouvir" : "Falar"}
        className={`grid h-[50px] w-[50px] flex-none place-items-center rounded-full bg-accent text-accent-ink ${voice.listening ? "ring-4 ring-glow" : ""}`}>
        <IconMic className="h-[22px] w-[22px]" />
      </button>
      {form}
    </div>
  );
}
