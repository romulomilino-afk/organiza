"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requireAccess } from "@/lib/session";
import { hasFeature } from "@/lib/plans";
import { decideClosing, moveReserve, type ClosingDecision } from "@/lib/months";
import { AppError } from "@/lib/errors";

const refresh = () => revalidatePath("/", "layout");

export async function decideClosingAction(decision: ClosingDecision) {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "financeiro")) return;
  if (!["RESERVE", "CARRY", "IGNORE"].includes(decision)) return;
  await decideClosing(getDb(), user, decision);
  refresh();
}

export type ReserveState = { error?: string; ok?: string } | undefined;

export async function moveReserveAction(_prev: ReserveState, form: FormData): Promise<ReserveState> {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "financeiro")) return { error: "A reserva faz parte do plano Premium." };
  const f = z.object({ valor: z.string().max(20), kind: z.enum(["IN", "OUT"]), toMonth: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!f.success) return { error: "Confira o valor." };
  const cents = Math.round(Number(f.data.valor.replace(/\./g, "").replace(",", ".")) * 100);
  try {
    await moveReserve(getDb(), user, cents, f.data.kind, f.data.toMonth === "on");
  } catch (e) {
    return { error: e instanceof AppError ? e.publicMessage : "Não consegui salvar agora." };
  }
  refresh();
  return { ok: f.data.kind === "IN" ? "Guardado na reserva ✓" : "Retirado da reserva ✓" };
}
