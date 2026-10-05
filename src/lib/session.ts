import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { unauthorized } from "./errors";
import { getAccess, type Access } from "./access";
import { setRequestCurrency } from "./money";

/**
 * Único ponto de onde sai o userId usado nas consultas.
 * Nunca aceite userId vindo do cliente.
 */
export async function currentUser(): Promise<User | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [u] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  if (u) setRequestCurrency(u.currency); // moeda da pessoa para toda a tela
  return u ?? null;
}

/** Para APIs e server actions: lança 401 se não houver sessão. */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw unauthorized();
  return u;
}

/** Para páginas: redireciona para o login (e para o onboarding, se preciso). */
export async function requirePageUser(opts: { allowNotOnboarded?: boolean } = {}): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (!u.onboarded && !opts.allowNotOnboarded) redirect("/onboarding");
  return u;
}

/** Usuário + o que ele pode ver (plano efetivo e família). */
export async function requireAccess(): Promise<{ user: User; access: Access }> {
  const user = await requireUser();
  return { user, access: await getAccess(getDb(), user) };
}

export async function requirePageAccess(opts: { allowNotOnboarded?: boolean } = {}): Promise<{ user: User; access: Access }> {
  const user = await requirePageUser(opts);
  return { user, access: await getAccess(getDb(), user) };
}
