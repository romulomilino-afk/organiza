import { redirect } from "next/navigation";
import { auth, isGoogleEnabled } from "@/auth";
import { AuthForm } from "@/components/AuthForm";

export default async function CadastroPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  const path = callbackUrl ? (() => { try { const u = new URL(callbackUrl, "http://x"); return u.pathname + u.search; } catch { return undefined; } })() : undefined;
  if ((await auth())?.user) redirect(path ?? "/");
  return (
    <>
      <div>
        <h1 className="text-[34px] font-bold leading-tight">Crie sua conta</h1>
        <p className="mt-2 text-lg text-ink-2">Sua vida é cheia de coisas para lembrar. Deixa isso com a Nina.</p>
      </div>
      <AuthForm mode="cadastro" googleEnabled={isGoogleEnabled} callbackUrl={path} />
    </>
  );
}
