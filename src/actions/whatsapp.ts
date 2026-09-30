"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireAccess, requireUser } from "@/lib/session";
import { createLinkCode, unlinkPhone } from "@/lib/whatsapp";
import { hasFeature } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";

export async function generateWhatsAppCode(): Promise<{ code?: string; error?: string }> {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "whatsapp")) return { error: "A Nina no WhatsApp faz parte do plano Premium." };
  if (!rateLimit(`wacode:${user.id}`, 5, 60 * 60_000)) return { error: "Muitos códigos gerados. Tente daqui a pouco." };
  return { code: await createLinkCode(getDb(), user.id) };
}

export async function disconnectWhatsApp() {
  const user = await requireUser();
  await unlinkPhone(getDb(), user.id);
  revalidatePath("/config");
}
