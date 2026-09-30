import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/db";
import { AppError, route } from "@/lib/errors";
import { handleAsaasEvent } from "@/lib/billing";
import { log } from "@/lib/logger";

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  event: z.string().min(1).max(80),
  payment: z.object({
    id: z.string(), subscription: z.string().nullish().transform((v) => v ?? undefined),
    dueDate: z.string().nullish().transform((v) => v ?? undefined), invoiceUrl: z.string().nullish().transform((v) => v ?? undefined),
    status: z.string().nullish().transform((v) => v ?? undefined),
  }).passthrough().nullish().transform((v) => v ?? undefined),
  subscription: z.object({ id: z.string() }).passthrough().nullish().transform((v) => v ?? undefined),
}).passthrough();

function tokenOk(req: Request) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN ?? "";
  const got = req.headers.get("asaas-access-token") ?? "";
  if (expected.length < 32) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Webhook do Asaas (configure em Asaas → Integrações → Webhooks, com o token de autenticação). */
export const POST = route("webhook.asaas", async (req: Request) => {
  if (!tokenOk(req)) throw new AppError(401, "Não autorizado.", "unauthorized");
  const ev = eventSchema.parse(await req.json());
  const result = await handleAsaasEvent(getDb(), ev);
  log.info("webhook.asaas", { event: ev.event, result });
  return NextResponse.json({ received: true });
});
