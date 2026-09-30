"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatResponse, SuggestionResponse } from "@/lib/nina/types";

/** Estado da conversa no cliente + chamadas à API da Nina. */
export function useNina(initial: ChatMessage[] = []) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (text: string, source: "TEXT" | "VOICE" = "TEXT") => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setError(null);
    const tempId = `tmp-${Date.now()}`;
    setMessages((m) => [...m, { id: tempId, role: "USER", content: t, cards: [], suggestion: null, createdAt: new Date().toISOString() }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t, source }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((m) => m.filter((x) => x.id !== tempId));
        setError(data.error ?? "Não consegui falar com a Nina agora.");
        return;
      }
      const r = data as ChatResponse;
      setMessages((m) => [...m.filter((x) => x.id !== tempId), r.user, r.assistant]);
      router.refresh(); // atualiza resumo do dia, agenda, listas
    } catch {
      setMessages((m) => m.filter((x) => x.id !== tempId));
      setError("Sem conexão. Verifique sua internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  const answer = useCallback(async (messageId: string, accept: boolean) => {
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, suggestion: null } : x)));
    const res = await fetch("/api/chat/suggestion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId, accept }) });
    const data = (await res.json().catch(() => ({}))) as SuggestionResponse & { error?: string };
    if (!res.ok) { setError(data.error ?? "Não consegui responder agora."); return; }
    if (data.followUp) { await send(data.followUp); return; }
    setMessages((m) => [...m, ...data.messages]);
    router.refresh();
  }, [router, send]);

  return { messages, busy, error, setError, send, answer };
}
