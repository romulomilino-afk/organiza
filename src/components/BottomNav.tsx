"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCal, IconChat, IconHome, IconHouse, IconWallet } from "./icons";

const ITEMS = [
  { href: "/", label: "Início", Icon: IconHome },
  { href: "/nina", label: "Nina", Icon: IconChat },
  { href: "/agenda", label: "Agenda", Icon: IconCal },
  { href: "/financeiro", label: "Dinheiro", Icon: IconWallet },
  { href: "/casa", label: "Casa", Icon: IconHouse },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-safe" aria-label="Navegação principal">
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {ITEMS.map(({ href, label, Icon }) => {
          const on = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={`flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[11.5px] font-semibold ${on ? "text-accent" : "text-ink-3"}`}>
              <Icon className="h-[22px] w-[22px]" />{label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
