import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <Link href="/" className="btn w-fit">Voltar ao início</Link>
    </main>
  );
}
