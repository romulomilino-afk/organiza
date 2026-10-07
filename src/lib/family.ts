/**
 * Plano Família: uma família por pessoa, até 5 pessoas, convite por link de uso único (7 dias).
 * O link carrega um token aleatório; no banco fica só o hash (sha256).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { householdInvites, householdMembers, households, users, type User } from "@/db/schema";
import { getAccess } from "./access";
import { PLANS, planWithTrial, type PlanId } from "./plans";
import { AppError } from "./errors";
import { log } from "./logger";

const MAX = PLANS.FAMILY.maxMembers;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createHousehold(db: DB, user: User, name: string) {
  if (planWithTrial(user.plan as PlanId, user.trialEndsAt) !== "FAMILY") throw new AppError(402, "Criar uma família faz parte do plano Família.", "plan_required");
  const a = await getAccess(db, user);
  if (a.household) throw new AppError(409, "Você já participa de uma família.", "already_member");
  const [h] = await db.insert(households).values({ name: name.trim().slice(0, 60) || "Minha família", ownerId: user.id }).returning();
  await db.insert(householdMembers).values({ householdId: h.id, userId: user.id, role: "OWNER" });
  log.info("family.created", { userId: user.id });
  return h;
}

export async function memberCount(db: DB, householdId: string) {
  const [{ n }] = await db.select({ n: count() }).from(householdMembers).where(eq(householdMembers.householdId, householdId));
  return n;
}

export async function listMembers(db: DB, householdId: string) {
  return db.select({ userId: users.id, name: users.name, email: users.email, role: householdMembers.role, joinedAt: householdMembers.joinedAt })
    .from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId)).orderBy(householdMembers.joinedAt);
}

/** Gera um link de convite. Só o dono, com o plano Família ativo e vaga disponível. */
export async function createInvite(db: DB, user: User): Promise<string> {
  const a = await getAccess(db, user);
  if (!a.household || a.household.role !== "OWNER") throw new AppError(403, "Só quem criou a família pode convidar.", "forbidden");
  if (!a.household.active) throw new AppError(402, "Ative o plano Família para convidar pessoas.", "plan_required");
  if ((await memberCount(db, a.household.id)) >= MAX) throw new AppError(409, `A família já tem ${MAX} pessoas.`, "full");
  const token = randomBytes(24).toString("base64url");
  await db.insert(householdInvites).values({
    householdId: a.household.id, tokenHash: hash(token), createdBy: user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
  return token;
}

export async function findInvite(db: DB, token: string) {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const [inv] = await db.select({ invite: householdInvites, household: households }).from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .where(and(eq(householdInvites.tokenHash, hash(token)), isNull(householdInvites.acceptedAt), isNull(householdInvites.revokedAt), gt(householdInvites.expiresAt, new Date())))
    .limit(1);
  return inv ?? null;
}

export async function acceptInvite(db: DB, user: User, token: string) {
  const inv = await findInvite(db, token);
  if (!inv) throw new AppError(404, "Esse convite expirou ou já foi usado. Peça um novo link.", "invalid_invite");
  const a = await getAccess(db, user);
  if (a.household?.id === inv.household.id) return inv.household;
  if (a.household) throw new AppError(409, "Você já participa de outra família. Saia dela antes de aceitar.", "already_member");
  if ((await memberCount(db, inv.household.id)) >= MAX) throw new AppError(409, "Essa família já está completa.", "full");
  await db.transaction(async (tx) => {
    const used = await tx.update(householdInvites).set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(and(eq(householdInvites.id, inv.invite.id), isNull(householdInvites.acceptedAt))).returning({ id: householdInvites.id });
    if (!used.length) throw new AppError(409, "Esse convite acabou de ser usado.", "invalid_invite");
    await tx.insert(householdMembers).values({ householdId: inv.household.id, userId: user.id, role: "MEMBER" });
  });
  log.info("family.joined", { userId: user.id });
  return inv.household;
}

export async function removeMember(db: DB, owner: User, memberId: string) {
  const a = await getAccess(db, owner);
  if (!a.household || a.household.role !== "OWNER") throw new AppError(403, "Só quem criou a família pode remover pessoas.", "forbidden");
  if (memberId === owner.id) throw new AppError(400, "Para sair, apague a família.", "invalid");
  await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a.household.id), eq(householdMembers.userId, memberId)));
}

/** Membro sai; dono apaga a família (itens compartilhados voltam a ser de quem criou). */
export async function leaveHousehold(db: DB, user: User) {
  const a = await getAccess(db, user);
  if (!a.household) return;
  if (a.household.role === "OWNER") await db.delete(households).where(eq(households.id, a.household.id));
  else await db.delete(householdMembers).where(eq(householdMembers.userId, user.id));
  log.info("family.left", { userId: user.id, owner: a.household.role === "OWNER" });
}

export async function setShareFinance(db: DB, owner: User, share: boolean) {
  const a = await getAccess(db, owner);
  if (!a.household || a.household.role !== "OWNER") throw new AppError(403, "Só quem criou a família pode mudar isso.", "forbidden");
  await db.update(households).set({ shareFinance: share }).where(eq(households.id, a.household.id));
}
