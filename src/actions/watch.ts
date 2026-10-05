"use server";
/**
 * "Não deixe nada passar" pela tela: vencimentos e compras de rotina (mesmas regras da Nina).
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { deadlines, shoppingRoutines } from "@/db/schema";
import { requireAccess } from "@/lib/session";
import { visible } from "@/lib/access";
import { isISODate, todayIn } from "@/lib/dates";
import { ActionSchema } from "@/lib/nina/actions";
import { executeActions } from "@/lib/nina/executor";

const refresh = () => { revalidatePath("/", "layout"); };
const id = z.string().min(1).max(64);

export async function addDeadlineForm(form: FormData) {
  const { user, access } = await requireAccess();
  const f = z.object({
    name: z.string().trim().min(1).max(80),
    date: z.string().refine(isISODate),
    remind: z.coerce.number().int().min(0).max(365).default(30),
    renew: z.enum(["", "12", "24", "60", "120"]).default(""),
  }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  await executeActions(getDb(), access, todayIn(user.timezone), [ActionSchema.parse({
    type: "add_deadline", name: f.data.name, date: f.data.date, remindDaysBefore: f.data.remind, renewMonths: f.data.renew ? Number(f.data.renew) : null,
  })]);
  refresh();
}

export async function completeDeadlineAction(deadlineId: string) {
  const { user, access } = await requireAccess();
  await executeActions(getDb(), access, todayIn(user.timezone), [ActionSchema.parse({ type: "complete_deadline", id: id.parse(deadlineId) })]);
  refresh();
}

export async function deleteDeadlineAction(deadlineId: string) {
  const { user } = await requireAccess();
  await getDb().delete(deadlines).where(and(eq(deadlines.id, id.parse(deadlineId)), eq(deadlines.userId, user.id)));
  refresh();
}

export async function addRoutineForm(form: FormData) {
  const { user, access } = await requireAccess();
  const f = z.object({ item: z.string().trim().min(1).max(80), every: z.coerce.number().int().min(1).max(365), now: z.string().optional() }).safeParse(Object.fromEntries(form));
  if (!f.success) return;
  await executeActions(getDb(), access, todayIn(user.timezone), [ActionSchema.parse({ type: "add_shopping_routine", item: f.data.item, everyDays: f.data.every, addNow: f.data.now === "on" })]);
  refresh();
}

export async function cancelRoutineAction(routineId: string) {
  const { access } = await requireAccess();
  await getDb().update(shoppingRoutines).set({ active: false }).where(and(eq(shoppingRoutines.id, id.parse(routineId)), visible(shoppingRoutines, access)));
  refresh();
}
