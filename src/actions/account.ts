"use server";
import { getDb } from "@/db";
import { requireUser } from "@/lib/session";
import { deleteAccount } from "@/lib/account";
import { signOut } from "@/auth";

export type DeleteState = { error?: string } | undefined;

export async function deleteAccountAction(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const user = await requireUser();
  const typed = String(form.get("confirm") ?? "").trim().toUpperCase();
  if (typed !== "EXCLUIR") return { error: "Digite EXCLUIR para confirmar." };
  try {
    await deleteAccount(getDb(), user);
  } catch {
    return { error: "Não consegui excluir agora. Tente de novo em alguns minutos." };
  }
  await signOut({ redirectTo: "/login?excluida=1" });
}
