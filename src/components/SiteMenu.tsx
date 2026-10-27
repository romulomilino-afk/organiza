"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

const LINKS = [
  ["#como-funciona", "Como funciona"], ["#beneficios", "Benefícios"], ["#planos", "Planos"], ["#instalar", "Instalar"], ["#duvidas", "Dúvidas"],
] as const;

/** Menu do site no celular: botão ☰ que abre as seções e o "Entrar". Some em telas grandes (lá o menu fica no topo). */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => { if (!(e.target as Element).closest?.("#menu-site, [aria-controls='menu-site']")) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("click", onClick); };
  }, [open]);
  return (
    <div className="md:hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="menu-site" aria-label={open ? "Fechar menu" : "Abrir menu"}
        className="grid h-11 w-11 place-items-center rounded-xl border" style={{ borderColor: "#D5DBD7", color: "#14231E" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
          <nav id="menu-site" aria-label="Seções" className="absolute left-0 right-0 top-full z-20 border-b px-4 pb-5 pt-2 shadow-lg" style={{ background: "#F6F5F0", borderColor: "#E2E5DF" }}>
            {LINKS.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="block border-b py-4 text-[18px] font-semibold" style={{ borderColor: "#E2E5DF", color: "#14231E" }}>{label}</a>
            ))}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Link href="/login" className="rounded-xl border py-3 text-center text-[16px] font-semibold" style={{ borderColor: "#17624F", color: "#17624F" }}>Entrar</Link>
              <Link href="/cadastro" className="rounded-xl py-3 text-center text-[16px] font-bold" style={{ background: "#17624F", color: "#F6F5F0" }}>Começar grátis</Link>
            </div>
          </nav>
      )}
    </div>
  );
}
