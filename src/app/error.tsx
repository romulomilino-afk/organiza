"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">Algo deu errado</h1>
      <p className="text-ink-2">Não foi culpa sua. Tente de novo; se continuar, recarregue a página.</p>
      <button className="btn w-fit" onClick={reset}>Tentar de novo</button>
    </main>
  );
}
