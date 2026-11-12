"use server";
/**
 * Cartões pela tela: mesmas regras e validação das ações da Nina.
 */
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { cardPurchases, creditCards } from "@/db/schema";
import { requireAccess } from "@/lib/session";
import { hasFeature } from "@/lib/plans";
import { isISODate, todayIn } from "@/lib/dates";
import { ActionSchema } from "@/lib/nina/actions";
import { executeActions } from "@/lib/nina/executor";
import { payInvoice, setPurchaseCategory } from "@/lib/cards";
import { loadCategories } from "@/lib/data/user-categories";
import { guessCategory } from "@/lib/nina/fallback";

const refresh = () => { revalidatePath("/", "layout"); };
const money = z.string().trim().transform((v) => Number(v.replace(/\./g, "").replace(",", "."))).pipe(z.number().positive().max(10_000_000));
const day = z.coerce.number().int().min(1).max(31);

async function guard() {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "financeiro")) return null;
  return { user, access, today: todayIn(user.timezone) };
}

export async function addCardForm(form: FormData) {
  const g = await guard(); if (!g) return;
  const { access, today } = g;
  const f = z.object({ name: z.string().trim().min(1).max(40), closingDay: day, dueDay: day, limit: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const limit = f.data.limit ? money.safeParse(f.data.limit) : null;
  await executeActions(getDb(), access, today, [ActionSchema.parse({ type: "add_card", name: f.data.name, closingDay: f.data.closingDay, dueDay: f.data.dueDay, limit: limit?.success ? limit.data : undefined })]);
  refresh();
}

export async function addPurchaseForm(form: FormData) {
  const g = await guard(); if (!g) return;
  const { user, access, today } = g;
  const f = z.object({ cardId: z.string().min(1).max(64), description: z.string().trim().min(1).max(120), amount: money,
    installments: z.coerce.number().int().min(1).max(48), date: z.string().optional(), category: z.string().max(64).optional() }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const [card] = await getDb().select().from(creditCards).where(and(eq(creditCards.id, f.data.cardId), eq(creditCards.userId, user.id))).limit(1);
  if (!card) return;
  const norm = f.data.description.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  await executeActions(getDb(), access, today, [ActionSchema.parse({
    type: "add_card_purchase", card: card.name, description: f.data.description, amount: f.data.amount, installments: f.data.installments,
    date: f.data.date && isISODate(f.data.date) && f.data.date <= today ? f.data.date : undefined, category: guessCategory(norm),
  })]);
  // categoria escolhida na tela vale mais que a automática
  const chosen = f.data.category ? (await loadCategories(getDb(), user.id)).find(f.data.category) : null;
  if (chosen && chosen.kind === "EXPENSE") {
    const [p] = await getDb().select({ id: cardPurchases.id }).from(cardPurchases)
      .where(and(eq(cardPurchases.userId, user.id), eq(cardPurchases.cardId, card.id))).orderBy(desc(cardPurchases.createdAt)).limit(1);
    if (p) await setPurchaseCategory(getDb(), user.id, p.id, chosen.key);
  }
  refresh();
}

export async function updatePurchaseCategoryAction(form: FormData) {
  const g = await guard(); if (!g) return;
  const f = z.object({ purchaseId: z.string().min(1).max(64), category: z.string().min(1).max(64) }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const cat = (await loadCategories(getDb(), g.user.id)).find(f.data.category);
  if (!cat || cat.kind !== "EXPENSE") return;
  await setPurchaseCategory(getDb(), g.user.id, f.data.purchaseId, cat.key);
  refresh();
}

export async function payInvoiceAction(cardId: string, dueDate: string) {
  const g = await guard(); if (!g) return;
  const { user, today } = g;
  const [card] = await getDb().select().from(creditCards).where(and(eq(creditCards.id, z.string().max(64).parse(cardId)), eq(creditCards.userId, user.id))).limit(1);
  if (!card || !isISODate(dueDate)) return;
  await payInvoice(getDb(), user.id, card, today, dueDate);
  refresh();
}

export async function cancelPurchaseAction(purchaseId: string) {
  const g = await guard(); if (!g) return;
  const { access, today } = g;
  await executeActions(getDb(), access, today, [ActionSchema.parse({ type: "cancel_card_purchase", id: purchaseId })]);
  refresh();
}

export async function deleteCardAction(cardName: string) {
  const g = await guard(); if (!g) return;
  const { access, today } = g;
  await executeActions(getDb(), access, today, [ActionSchema.parse({ type: "delete_card", card: cardName })]);
  refresh();
}
