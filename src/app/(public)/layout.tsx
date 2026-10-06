import Link from "next/link";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="flex items-center gap-2 font-display text-[15px] font-bold tracking-wide text-accent">
        <span className="relative inline-block h-[22px] w-[22px] rounded-[7px] bg-accent after:absolute after:inset-[6px] after:rounded-full after:bg-glow" />
        Organiza
      </Link>
      {children}
      <footer className="mt-6 flex gap-4 text-sm text-ink-3">
        <Link href="/privacidade">Privacidade</Link>
        <Link href="/excluir-conta">Excluir conta</Link>
      </footer>
    </main>
  );
}
