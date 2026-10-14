"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requireUser } from "@/lib/session";
import { cancelBilling, startCheckout } from "@/lib/billing";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";

export type CheckoutState = { error?: string } | undefined;

export async function checkoutAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const user = await requireUser();
  if (!rateLimit(`checkout:${user.id}`, 5, 10 * 60_000)) return { error: "Muitas tentativas. Espere alguns minutos." };
  const parsed = z.object({
    plan: z.enum(["PREMIUM", "FAMILY"]),
    method: z.enum(["CREDIT_CARD", "PIX", "PIX_YEARLY"]).default("CREDIT_CARD"),
    doc: z.string().max(30).default(""), phone: z.string().max(30).default(""), name: z.string().max(120).default(""),
  }).safeParse({ plan: form.get("plan"), method: form.get("method") ?? undefined, doc: form.get("doc") ?? "", phone: form.get("phone") ?? "", name: form.get("name") ?? "" });
  if (!parsed.success) return { error: "Escolha um plano e a forma de pagamento." };
  const d = parsed.data;
  if (d.method !== "CREDIT_CARD" && d.name.trim().length < 3) return { error: "Informe seu nome completo." };
  let url: string;
  try {
    url = await startCheckout(getDb(), user, d.plan, d.doc, d.method, d.phone, d.name);
  } catch (e) {
    return { error: e instanceof AppError ? e.publicMessage : "Não consegui iniciar o pagamento agora." };
  }
  revalidatePath("/planos");
  redirect(url); // página segura do Asaas: cartão (cobrança automática) ou Pix (QR Code e copia e cola)
}

export async function cancelAction() {
  const user = await requireUser();
  await cancelBilling(getDb(), user);
  revalidatePath("/", "layout");
  redirect("/planos?cancelada=1");
}
