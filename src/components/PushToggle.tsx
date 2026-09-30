"use client";
import { useEffect, useState } from "react";

function b64ToUint8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "ios-install" | "off" | "on" | "denied" | "server-off";

/** Ativa/desativa os avisos da Nina neste aparelho. */
export function PushToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState(ios && !standalone ? "ios-install" : "unsupported");
      const key = await fetch("/api/push").then((r) => r.json()).catch(() => ({ enabled: false }));
      if (!key.enabled) return setState("server-off");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  async function enable() {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(publicKey) });
      const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error();
      setState("on"); setMsg("Pronto! Vou te avisar só do que importa. 🔔");
    } catch {
      setMsg("Não consegui ativar os avisos neste aparelho.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off"); setBusy(false);
  }

  if (state === "loading" || (compact && state !== "off")) return null;
  const text: Record<State, string> = {
    loading: "", on: "Avisos ativados neste aparelho.",
    off: "Receba avisos de compromissos, contas e lembretes.",
    denied: "Os avisos estão bloqueados. Libere nas configurações do navegador.",
    unsupported: "Este navegador não recebe avisos.",
    "ios-install": "No iPhone, toque em Compartilhar → “Adicionar à Tela de Início” e abra o Organiza por lá para receber avisos.",
    "server-off": "Os avisos ainda não foram configurados no servidor (chaves VAPID).",
  };
  return (
    <div className={compact ? "card flex items-center gap-3" : "flex flex-col gap-2"}>
      <p className={`text-sm ${compact ? "flex-1" : ""} text-ink-2`}>🔔 {text[state]}</p>
      {state === "off" && <button disabled={busy} onClick={enable} className="btn w-fit whitespace-nowrap px-3 py-2 text-sm">{busy ? "Ativando…" : "Ativar avisos"}</button>}
      {state === "on" && <button disabled={busy} onClick={disable} className="btn btn-ghost w-fit px-3 py-2 text-sm">Desativar neste aparelho</button>}
      {msg && <p role="status" className="text-sm text-accent">{msg}</p>}
    </div>
  );
}
