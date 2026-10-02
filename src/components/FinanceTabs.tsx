import Link from "next/link";

/** Abas da área Dinheiro: Resumo × Cartões. */
export function FinanceTabs({ active }: { active: "resumo" | "cartoes" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined}
      className={`flex-1 rounded-xl py-2 text-center text-sm font-semibold ${on ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>{label}</Link>
  );
  return (
    <div className="mb-3 flex gap-1 rounded-2xl bg-surface-2 p-1">
      {tab("/financeiro", "Resumo", active === "resumo")}
      {tab("/financeiro/cartoes", "💳 Cartões", active === "cartoes")}
    </div>
  );
}
