import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { conversations, shoppingLists, userPreferences } from "@/db/schema";

/** Garante as estruturas básicas de um usuário (idempotente). */
export async function ensureUserSetup(db: DB, userId: string) {
  await db.insert(userPreferences).values({ userId }).onConflictDoNothing();
  const [list] = await db.select({ id: shoppingLists.id }).from(shoppingLists)
    .where(and(eq(shoppingLists.userId, userId), eq(shoppingLists.isDefault, true))).limit(1);
  if (!list) await db.insert(shoppingLists).values({ userId, name: "Compras", isDefault: true });
}

export async function defaultListId(db: DB, userId: string): Promise<string> {
  const [list] = await db.select({ id: shoppingLists.id }).from(shoppingLists)
    .where(and(eq(shoppingLists.userId, userId), eq(shoppingLists.isDefault, true))).limit(1);
  if (list) return list.id;
  const [created] = await db.insert(shoppingLists).values({ userId, name: "Compras", isDefault: true }).returning({ id: shoppingLists.id });
  return created.id;
}

/** A conversa ativa do usuário (uma por usuário no MVP). */
export async function activeConversationId(db: DB, userId: string): Promise<string> {
  const [c] = await db.select({ id: conversations.id }).from(conversations)
    .where(eq(conversations.userId, userId)).orderBy(conversations.createdAt).limit(1);
  if (c) return c.id;
  const [created] = await db.insert(conversations).values({ userId }).returning({ id: conversations.id });
  return created.id;
}

/** A lista de compras compartilhada da família (criada na primeira vez). */
export async function householdListId(db: DB, userId: string, householdId: string): Promise<string> {
  const [list] = await db.select({ id: shoppingLists.id }).from(shoppingLists)
    .where(eq(shoppingLists.householdId, householdId)).limit(1);
  if (list) return list.id;
  const [created] = await db.insert(shoppingLists).values({ userId, householdId, name: "Compras da família", isDefault: false }).returning({ id: shoppingLists.id });
  return created.id;
}
