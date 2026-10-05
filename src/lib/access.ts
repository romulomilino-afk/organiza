/**
 * Quem pode ver o quê.
 *
 * Cada pessoa vê o que é dela. Se estiver numa família, também vê os itens marcados
 * com o household_id da família (agenda, tarefas, compras e — se a família permitir — financeiro).
 * Toda consulta de dados passa por aqui.
 */
import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { DB } from "@/db";
import { householdMembers, households, users, type User } from "@/db/schema";
import type { PlanId } from "./plans";

export type Access = {
  userId: string;
  plan: PlanId;          // plano efetivo (membros de família herdam FAMILY)
  ownPlan: PlanId;
  timezone: string;
  currency: string;
  household: { id: string; name: string; role: "OWNER" | "MEMBER"; ownerId: string; shareFinance: boolean; active: boolean } | null;
};

export async function getAccess(db: DB, user: User): Promise<Access> {
  const [m] = await db.select({
    id: households.id, name: households.name, ownerId: households.ownerId, shareFinance: households.shareFinance,
    role: householdMembers.role, ownerPlan: users.plan,
  }).from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .innerJoin(users, eq(users.id, households.ownerId))
    .where(eq(householdMembers.userId, user.id)).limit(1);

  const ownPlan = user.plan as PlanId;
  // a família só está "ativa" (compartilhando) enquanto o dono tiver o plano Família
  const active = !!m && m.ownerPlan === "FAMILY";
  const plan: PlanId = active ? "FAMILY" : ownPlan;
  return {
    userId: user.id, plan, ownPlan, timezone: user.timezone, currency: user.currency ?? "BRL",
    household: m ? { id: m.id, name: m.name, role: m.role, ownerId: m.ownerId, shareFinance: m.shareFinance, active } : null,
  };
}

/** Acesso de quem não participa de família (testes e canais sem família). */
export function soloAccess(user: Pick<User, "id" | "plan" | "timezone"> & { currency?: string | null }): Access {
  return { userId: user.id, plan: user.plan as PlanId, ownPlan: user.plan as PlanId, timezone: user.timezone, currency: user.currency ?? "BRL", household: null };
}

export function sharedHouseholdId(a: Access): string | null {
  return a.household?.active ? a.household.id : null;
}

type Scoped = { userId: PgColumn; householdId: PgColumn };

/** Linhas visíveis: minhas OU da minha família (se ativa). */
export function visible(t: Scoped, a: Access): SQL {
  const hh = sharedHouseholdId(a);
  return hh ? or(eq(t.userId, a.userId), eq(t.householdId, hh))! : eq(t.userId, a.userId);
}

/** Só as minhas que não são compartilhadas. */
export function personal(t: Scoped, a: Access): SQL {
  return and(eq(t.userId, a.userId), isNull(t.householdId))!;
}
