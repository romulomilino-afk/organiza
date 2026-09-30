"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/session";
import { acceptInvite, createHousehold, createInvite, leaveHousehold, removeMember, setShareFinance } from "@/lib/family";
import { AppError } from "@/lib/errors";

export type FamilyState = { error?: string; link?: string } | undefined;
const refresh = () => revalidatePath("/", "layout");
const msg = (e: unknown) => (e instanceof AppError ? e.publicMessage : "Não consegui fazer isso agora.");

export async function createFamilyAction(_: FamilyState, form: FormData): Promise<FamilyState> {
  const user = await requireUser();
  try { await createHousehold(getDb(), user, String(form.get("name") ?? "")); } catch (e) { return { error: msg(e) }; }
  refresh();
  return {};
}

export async function inviteAction(): Promise<FamilyState> {
  const user = await requireUser();
  try {
    const token = await createInvite(getDb(), user);
    const h = await headers();
    const origin = process.env.AUTH_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    return { link: `${origin}/convite/${token}` };
  } catch (e) { return { error: msg(e) }; }
}

export async function acceptInviteAction(token: string) {
  const user = await requireUser();
  await acceptInvite(getDb(), user, z.string().max(80).parse(token));
  refresh();
  redirect("/familia");
}

export async function removeMemberAction(memberId: string) {
  const user = await requireUser();
  await removeMember(getDb(), user, z.string().max(64).parse(memberId));
  refresh();
}

export async function leaveFamilyAction() {
  const user = await requireUser();
  await leaveHousehold(getDb(), user);
  refresh();
}

export async function shareFinanceAction(share: boolean) {
  const user = await requireUser();
  await setShareFinance(getDb(), user, share);
  refresh();
}
