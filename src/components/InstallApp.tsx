"use client";
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Botão "Instalar o app": usa o convite nativo do Android/Chrome; no iPhone mostra o caminho pelo Safari. */
export function InstallApp() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    if (window.matchMedia("(display-mode: standalone)").matches) setDone(true);
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    const onInstalled = () => setDone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (done) return <p className="rounded-2xl bg-[#17624F] px-5 py-4 text-[16px] font-semibold text-[#F6F5F0]">✓ O Meu Organiza já está instalado neste aparelho.</p>;
  if (evt) {
    return (
      <button
        onClick={async () => { await evt.prompt(); const r = await evt.userChoice; if (r.outcome === "accepted") setDone(true); setEvt(null); }}
        className="rounded-2xl bg-[#F2C75C] px-7 py-4 text-[17px] font-bold text-[#0F2A22] shadow-sm transition hover:brightness-95"
      >
        Instalar o app agora
      </button>
    );
  }
  return (
    <p className="rounded-2xl bg-white/10 px-5 py-4 text-[15px] leading-relaxed text-[#C9DBD3]">
      {ios
        ? <>No iPhone: abra no <b className="text-[#F6F5F0]">Safari</b>, toque em <b className="text-[#F6F5F0]">Compartilhar</b> e depois em <b className="text-[#F6F5F0]">Adicionar à Tela de Início</b>.</>
        : <>Abra este site no celular, pelo <b className="text-[#F6F5F0]">Chrome</b> (Android) ou <b className="text-[#F6F5F0]">Safari</b> (iPhone), para instalar.</>}
    </p>
  );
}
