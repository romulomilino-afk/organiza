"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void;
};

/**
 * Entrada por voz em duas camadas:
 * 1) reconhecimento do próprio navegador (grátis; Chrome, Edge, Safari, Android)
 * 2) gravação + transcrição no servidor (/api/transcribe), quando configurada
 * Se nenhuma estiver disponível, orienta usar o ditado do teclado.
 */
export function useVoice(opts: { onPartial: (t: string) => void; onFinal: (t: string) => void; onError: (msg: string) => void }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SR | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const serverSTT = useRef<boolean | null>(null);
  const o = useRef(opts); o.current = opts;

  useEffect(() => {
    fetch("/api/transcribe").then((r) => r.ok ? r.json() : { enabled: false }).then((d) => { serverSTT.current = !!d.enabled; }).catch(() => { serverSTT.current = false; });
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
  }, []);

  const startServer = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (!blob.size) return;
        o.current.onPartial("Transcrevendo…");
        const fd = new FormData(); fd.append("audio", blob);
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        o.current.onPartial("");
        if (!res.ok) return o.current.onError(data.error ?? "Não consegui entender o áudio.");
        if (data.text) o.current.onFinal(data.text);
      };
      mediaRef.current = rec;
      rec.start();
      setListening(true);
      setTimeout(() => rec.state === "recording" && rec.stop(), 60_000);
    } catch {
      setListening(false);
      o.current.onError("Não consegui acessar o microfone. Libere o acesso nas configurações do navegador.");
    }
  }, []);

  const start = useCallback(() => {
    if (listening) return stop();
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = false;
      let finalText = "";
      rec.onresult = (e) => {
        let t = "";
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        finalText = t; o.current.onPartial(t);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          if (serverSTT.current) { recRef.current = null; startServer(); return; }
          o.current.onError("O microfone está bloqueado. Libere o acesso ou use o 🎤 do teclado.");
        } else if (e.error !== "no-speech" && e.error !== "aborted") o.current.onError("Não consegui ouvir. Tente de novo.");
      };
      rec.onend = () => { setListening(false); recRef.current = null; if (finalText.trim()) o.current.onFinal(finalText.trim()); };
      recRef.current = rec;
      try { rec.start(); setListening(true); } catch { setListening(false); }
      return;
    }
    if (serverSTT.current && typeof MediaRecorder !== "undefined") return void startServer();
    o.current.onError("Seu navegador não tem reconhecimento de voz. Use o 🎤 do teclado do celular para ditar.");
  }, [listening, startServer, stop]);

  return { listening, start, stop };
}
