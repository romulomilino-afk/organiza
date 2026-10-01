"use server";
/**
 * Fixos do mês pela tela Dinheiro: mesmas regras e validação das ações da Nina.
 */
import { revalidatePath } from "next/cache";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { expenses, recurringItems } from "@/db/schema";
import { requireAccess } from "@/lib/session";
import { hasFeature } from "@/lib/plans";
import { todayIn } from "@/lib/dates";
import { ActionSchema } from "@/lib/nina/actions";
import { executeActions } from "@/lib/nina/executor";
import { guessCategory } from "@/lib/nina/fallback";

const refresh = () => { revalidatePath("/", "layout"); };

const formSchema = z.object({
  tipo: z.enum(["receita", "despesa", "conta"]),
  name: z.string().trim().min(1).max(80),
  amount: z.string().trim().transform((v) => Number(v.replace(/\./g, "").replace(",", "."))).pipe(z.number().positive().max(10_000_000)),
  day: z.coerce.number().int().min(1).max(31),
});

export async function addFixed(form: FormData) {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "financeiro")) return;
  const f = formSchema.safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const { tipo, name, amount, day } = f.data;
  const norm = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const action = ActionSchema.parse({
    type: "add_fixed", kind: tipo === "receita" ? "income" : "expense", name, amount, day, auto: tipo === "despesa",
    category: tipo === "receita" ? (/salario/.test(norm) ? "salario" : "renda_extra") : guessCategory(norm),
  });
  await executeActions(getDb(), access, todayIn(user.timezone), [action]);
  refresh();
}

export async function cancelFixed(itemId: string) {
  const { user, access } = await requireAccess();
  const id = z.string().min(1).max(64).parse(itemId);
  const db = getDb();
  const [it] = await db.update(recurringItems).set({ active: false })
    .where(and(eq(recurringItems.id, id), eq(recurringItems.userId, access.userId))).returning();
  if (it) await db.delete(expenses).where(and(eq(expenses.recurringItemId, it.id), eq(expenses.status, "PENDING"), gt(expenses.dueDate, todayIn(user.timezone))));
  refresh();
}
