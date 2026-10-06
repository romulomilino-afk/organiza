import { redirect } from "next/navigation";
import { auth, isGoogleEnabled } from "@/auth";
import { AuthForm } from "@/components/AuthForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; excluida?: string }> }) {
  const { callbackUrl, excluida } = await searchParams;
  const path = callbackUrl ? (() => { try { const u = new URL(callbackUrl, "http://x"); return u.pathname + u.search; } catch { return undefined; } })() : undefined;
  if ((await auth())?.user) redirect(path ?? "/");
  return (
    <>
      {excluida && <p className="card text-[15px]">✅ Sua conta foi excluída e seus dados foram apagados.</p>}
      <div>
        <h1 className="text-[34px] font-bold leading-tight">Que bom te ver</h1>
        <p className="mt-2 text-lg text-ink-2">Você fala. A gente organiza.</p>
      </div>
      <AuthForm mode="login" googleEnabled={isGoogleEnabled} callbackUrl={path} />
    </>
  );
}
