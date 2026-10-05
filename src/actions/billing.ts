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
  const parsed = z.object({ plan: z.enum(["PREMIUM", "FAMILY"]), doc: z.string().max(30).default("") })
    .safeParse({ plan: form.get("plan"), doc: form.get("doc") ?? "" });
  if (!parsed.success) return { error: "Escolha um plano." };
  let url: string;
  try {
    url = await startCheckout(getDb(), user, parsed.data.plan, parsed.data.doc, "CREDIT_CARD"); // só cartão, cobrança automática
  } catch (e) {
    return { error: e instanceof AppError ? e.publicMessage : "Não consegui iniciar o pagamento agora." };
  }
  redirect(url); // página segura do Asaas para o cartão (cobrança automática todo mês)
}

export async function cancelAction() {
  const user = await requireUser();
  await cancelBilling(getDb(), user);
  revalidatePath("/", "layout");
}
