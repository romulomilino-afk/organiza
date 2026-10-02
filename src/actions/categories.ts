"use server";
/**
 * Categorias pela tela Dinheiro: mesmas regras e validação das ações da Nina.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requireAccess } from "@/lib/session";
import { hasFeature } from "@/lib/plans";
import { todayIn } from "@/lib/dates";
import { ActionSchema } from "@/lib/nina/actions";
import { executeActions } from "@/lib/nina/executor";

const refresh = () => { revalidatePath("/", "layout"); };

const formSchema = z.object({
  name: z.string().trim().min(1).max(40),
  emoji: z.string().trim().max(8).optional(),
  kind: z.enum(["expense", "income"]).default("expense"),
  keywords: z.string().max(400).optional(),
});

export async function addCategoryForm(form: FormData) {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "financeiro")) return;
  const f = formSchema.safeParse(Object.fromEntries(form));
  if (!f.success) return;
  const keywords = (f.data.keywords ?? "").split(/[,;\n]/).map((k) => k.trim()).filter((k) => k.length >= 3).slice(0, 20);
  const action = ActionSchema.parse({ type: "add_category", name: f.data.name, emoji: f.data.emoji || null, kind: f.data.kind, keywords });
  await executeActions(getDb(), access, todayIn(user.timezone), [action]);
  refresh();
}

export async function deleteCategory(name: string) {
  const { user, access } = await requireAccess();
  const action = ActionSchema.parse({ type: "delete_category", name: z.string().min(1).max(40).parse(name) });
  await executeActions(getDb(), access, todayIn(user.timezone), [action]);
  refresh();
}
