"use server";
/** Ações da área Minha Casa: documentos, garantias e assinaturas. */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { creditCards, documents, subscriptions, warranties, userPreferences } from "@/db/schema";
import { requireAccess, requireUser } from "@/lib/session";
import { addMonths, cap, isISODate, isTime, todayIn } from "@/lib/dates";
import { toCents } from "@/lib/money";
import { hasFeature } from "@/lib/plans";
import { deleteFile } from "@/lib/storage";
import { ensureSubscriptionCharges, followingCharge } from "@/lib/subscriptions";

/** "Como é paga": "conta" (desconta da receita) ou o id de um cartão do usuário. */
async function payWith(userId: string, v: FormDataEntryValue | null): Promise<string | null> {
  const s = String(v ?? "");
  if (!s || s === "conta") return null;
  const [c] = await getDb().select({ id: creditCards.id }).from(creditCards).where(and(eq(creditCards.id, s.slice(0, 64)), eq(creditCards.userId, userId))).limit(1);
  return c?.id ?? null;
}

/** Próxima cobrança informada; se já passou, vai para a seguinte (não lança cobrança antiga). */
function nextFrom(date: string, today: string, cycle: "MONTHLY" | "YEARLY") {
  const day = Number(date.slice(8, 10));
  let d = date;
  for (let i = 0; d < today && i < 40; i++) d = followingCharge(d, day, cycle);
  return { nextBilling: d, billingDay: day };
}

const id = z.string().min(1).max(64);
const refresh = () => revalidatePath("/", "layout");

export async function deleteDocument(docId: string) {
  const u = await requireUser(); const db = getDb();
  const [d] = await db.delete(documents).where(and(eq(documents.id, id.parse(docId)), eq(documents.userId, u.id))).returning();
  if (d?.fileKey) await deleteFile(d.fileKey).catch(() => undefined);
  refresh();
}

export async function addWarranty(form: FormData) {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "garantias")) return;
  const p = z.object({ item: z.string().trim().min(1).max(80), months: z.coerce.number().int().min(1).max(240), purchaseDate: z.string().optional() })
    .safeParse({ item: form.get("item"), months: form.get("months"), purchaseDate: form.get("purchaseDate") || undefined });
  if (!p.success) return;
  const purchaseDate = p.data.purchaseDate && isISODate(p.data.purchaseDate) ? p.data.purchaseDate : todayIn(user.timezone);
  await getDb().insert(warranties).values({ userId: user.id, item: cap(p.data.item), months: p.data.months, purchaseDate, expiresAt: addMonths(purchaseDate, p.data.months) });
  refresh();
}

export async function deleteWarranty(wId: string) {
  const u = await requireUser();
  await getDb().delete(warranties).where(and(eq(warranties.id, id.parse(wId)), eq(warranties.userId, u.id)));
  refresh();
}

export async function addSubscription(form: FormData) {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "assinaturas")) return;
  const p = z.object({
    name: z.string().trim().min(1).max(80),
    amount: z.string().transform((v) => Number(v.replace(/\./g, "").replace(",", "."))).pipe(z.number().positive().max(100000)),
    cycle: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
    next: z.string().optional(),
  }).safeParse({ name: form.get("name"), amount: String(form.get("amount") ?? ""), cycle: form.get("cycle") || undefined, next: form.get("next") || undefined });
  if (!p.success) return;
  const today = todayIn(user.timezone);
  const when = p.data.next && isISODate(p.data.next) ? nextFrom(p.data.next, today, p.data.cycle) : {};
  await getDb().insert(subscriptions).values({ userId: user.id, name: cap(p.data.name), amountCents: toCents(p.data.amount), cycle: p.data.cycle,
    ...when, cardId: await payWith(user.id, form.get("pay")) });
  await ensureSubscriptionCharges(getDb(), user.id, today);
  refresh();
}

export async function updateSubscription(form: FormData) {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "assinaturas")) return;
  const p = z.object({
    id,
    amount: z.string().transform((v) => Number(v.replace(/\./g, "").replace(",", "."))).pipe(z.number().positive().max(100000)),
    cycle: z.enum(["MONTHLY", "YEARLY"]),
    next: z.string().optional(),
  }).safeParse({ id: form.get("id"), amount: String(form.get("amount") ?? ""), cycle: form.get("cycle"), next: form.get("next") || undefined });
  if (!p.success) return;
  const today = todayIn(user.timezone);
  const when = p.data.next && isISODate(p.data.next) ? nextFrom(p.data.next, today, p.data.cycle) : {};
  await getDb().update(subscriptions).set({ amountCents: toCents(p.data.amount), cycle: p.data.cycle, ...when, cardId: await payWith(user.id, form.get("pay")) })
    .where(and(eq(subscriptions.id, p.data.id), eq(subscriptions.userId, user.id)));
  await ensureSubscriptionCharges(getDb(), user.id, today);
  refresh();
}

export async function cancelSubscription(sId: string) {
  const u = await requireUser();
  await getDb().update(subscriptions).set({ active: false }).where(and(eq(subscriptions.id, id.parse(sId)), eq(subscriptions.userId, u.id)));
  refresh();
}

export async function saveNotificationPrefs(form: FormData) {
  const u = await requireUser();
  const enabled = form.get("enabled") === "on";
  const start = String(form.get("quietStart") ?? "22:00"), end = String(form.get("quietEnd") ?? "07:00");
  await getDb().update(userPreferences).set({
    notificationsEnabled: enabled, quietHoursStart: isTime(start) ? start : "22:00", quietHoursEnd: isTime(end) ? end : "07:00",
  }).where(eq(userPreferences.userId, u.id));
  refresh();
}
