export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-7 px-4 py-10">
      <div className="flex items-center gap-2 font-display text-[15px] font-bold tracking-wide text-accent">
        <span className="relative inline-block h-[22px] w-[22px] rounded-[7px] bg-accent after:absolute after:inset-[6px] after:rounded-full after:bg-glow" />
        Organiza
      </div>
      {children}
      <a href="/privacidade" className="text-center text-sm text-ink-3 underline">Política de Privacidade</a>
    </main>
  );
}
