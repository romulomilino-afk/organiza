"use server";
/** Vales (alimentação/refeição) pela tela: mesmas regras das ações da Nina. */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { benefitCards, benefitEntries } from "@/db/schema";
import { requireAccess } from "@/lib/session";
import { hasFeature } from "@/lib/plans";
import { isISODate, todayIn, cap } from "@/lib/dates";
import { toCents } from "@/lib/money";
import { ActionSchema } from "@/lib/nina/actions";
import { executeActions } from "@/lib/nina/executor";
import { setBenefitBalance } from "@/lib/benefits";
import { loadCategories } from "@/lib/data/user-categories";

const refresh = () => { revalidatePath("/", "layout"); };
const money = z.string().trim().transform((v) => Number(v.replace(/\./g, "").replace(",", "."))).pipe(z.number().min(0).max(1_000_000));
const optMoney = z.string().optional().transform((v) => (v && v.trim() ? Number(v.replace(/\./g, "").replace(",", ".")) : null)).pipe(z.number().min(0).max(1_000_000).nullable());
const id = z.string().min(1).max(64);

async function guard() {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "financeiro")) return null;
  return { user, access, today: todayIn(user.timezone) };
}
async function ownCard(userId: string, cardId: string) {
  const [c] = await getDb().select().from(benefitCards).where(and(eq(benefitCards.id, cardId), eq(benefitCards.userId, userId), eq(benefitCards.active, true))).limit(1);
  return c ?? null;
}

export async function addBenefitForm(form: FormData) {
  const g = await guard(); if (!g) return;
  const f = z.object({ name: z.string().trim().max(40).optional(), kind: z.enum(["alimentacao", "refeicao", "outro"]), monthly: optMoney,
    day: z.coerce.number().int().min(1).max(31), balance: optMoney }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  await executeActions(getDb(), g.access, g.today, [ActionSchema.parse({ type: "add_benefit_card", name: f.data.name || null, kind: f.data.kind,
    monthly: f.data.monthly || undefined, day: f.data.day, balance: f.data.balance ?? undefined })]);
  refresh();
}

export async function updateBenefitForm(form: FormData) {
  const g = await guard(); if (!g) return;
  const f = z.object({ cardId: id, monthly: money, day: z.coerce.number().int().min(1).max(31), balance: optMoney }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const card = await ownCard(g.user.id, f.data.cardId); if (!card) return;
  const [upd] = await getDb().update(benefitCards).set({ monthlyCents: toCents(f.data.monthly), creditDay: f.data.day }).where(eq(benefitCards.id, card.id)).returning();
  if (f.data.balance != null) await setBenefitBalance(getDb(), g.user.id, upd, toCents(f.data.balance), g.today);
  refresh();
}

export async function addBenefitSpendForm(form: FormData) {
  const g = await guard(); if (!g) return;
  const f = z.object({ cardId: id, description: z.string().trim().min(1).max(120), amount: money.pipe(z.number().positive()), category: z.string().max(64).optional(), date: z.string().optional() })
    .safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const card = await ownCard(g.user.id, f.data.cardId); if (!card) return;
  const cats = await loadCategories(getDb(), g.user.id);
  const chosen = f.data.category ? cats.find(f.data.category) : null;
  const categoryKey = chosen && chosen.kind === "EXPENSE" ? chosen.key : cats.resolve("alimentacao", f.data.description, "EXPENSE");
  const date = f.data.date && isISODate(f.data.date) && f.data.date <= g.today ? f.data.date : g.today;
  await getDb().insert(benefitEntries).values({ userId: g.user.id, cardId: card.id, kind: "GASTO", amountCents: toCents(f.data.amount), description: cap(f.data.description), categoryKey, date });
  refresh();
}

export async function deleteBenefitEntryAction(entryId: string) {
  const g = await guard(); if (!g) return;
  await getDb().delete(benefitEntries).where(and(eq(benefitEntries.id, id.parse(entryId)), eq(benefitEntries.userId, g.user.id)));
  refresh();
}

export async function deleteBenefitAction(cardId: string) {
  const g = await guard(); if (!g) return;
  await getDb().update(benefitCards).set({ active: false }).where(and(eq(benefitCards.id, id.parse(cardId)), eq(benefitCards.userId, g.user.id)));
  refresh();
}
