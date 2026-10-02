/**
 * Orquestrador da Nina: mensagem do usuário → resposta + ações executadas.
 *
 *   limite do plano → salva mensagem → contexto → IA (ou regras) → validação → filtro do plano
 *   → executor (transação, escopo userId) → salva resposta → conta interação
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { messages, usageCounters, type User } from "@/db/schema";
import { buildContext } from "./context";
import { callNina, llmEnabled, type Turn } from "./llm";
import { fallbackNina } from "./fallback";
import { parseNinaOutput, type Action, type Suggestion } from "./actions";
import { executeActions, type Card } from "./executor";
import { ACTION_FEATURE, hasFeature, PLANS, type PlanId } from "../plans";
import { ensureRecurringBills } from "../data/queries";
import { loadCategories } from "../data/user-categories";
import { cardsOverview } from "../cards";
import { activeConversationId } from "../data/user-setup";
import { monthKey, todayIn } from "../dates";
import { AppError } from "../errors";
import { getAccess, type Access } from "../access";
import { log } from "../logger";

import type { ChatMessage } from "./types";
export type { ChatMessage };

export function toChatMessage(m: typeof messages.$inferSelect): ChatMessage {
  const sg = m.suggestionState === "PENDING" ? (m.suggestion as Suggestion | null) : null;
  return {
    id: m.id, role: m.role, content: m.content, cards: (m.cards as Card[] | null) ?? [],
    suggestion: sg ? { text: sg.text, yes: sg.yes, no: sg.no } : null,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function usageThisMonth(db: DB, user: User, plan: PlanId = user.plan as PlanId) {
  const month = monthKey(todayIn(user.timezone));
  const [row] = await db.select().from(usageCounters).where(and(eq(usageCounters.userId, user.id), eq(usageCounters.month, month))).limit(1);
  const limit = PLANS[plan].monthlyInteractions;
  return { used: row?.interactions ?? 0, limit, month };
}

async function countInteraction(db: DB, userId: string, month: string) {
  await db.insert(usageCounters).values({ userId, month, interactions: 1 })
    .onConflictDoUpdate({ target: [usageCounters.userId, usageCounters.month], set: { interactions: sql`${usageCounters.interactions} + 1` } });
}

/** Remove ações de recursos fora do plano e devolve a nota para o usuário. */
function gateByPlan(plan: PlanId, actions: Action[]) {
  const allowed: Action[] = [];
  let blocked = false;
  for (const a of actions) {
    if (hasFeature(plan, ACTION_FEATURE[a.type])) allowed.push(a);
    else if (a.type !== "remember") blocked = true;
  }
  return { allowed, note: blocked ? "Essa parte (financeiro, assinaturas ou garantias) faz parte do plano Premium." : "" };
}

export async function handleMessage(db: DB, user: User, text: string, source: "TEXT" | "VOICE" = "TEXT", accessIn?: Access): Promise<{ user: ChatMessage; assistant: ChatMessage; mode: "ai" | "rules" }> {
  const access = accessIn ?? await getAccess(db, user);
  const plan = access.plan;
  const usage = await usageThisMonth(db, user, plan);
  if (usage.used >= usage.limit) {
    throw new AppError(402, `Você usou as ${usage.limit} interações do plano ${PLANS[plan].name} este mês. Assine o Premium para continuar conversando com a Nina.`, "limit_reached");
  }

  const today = todayIn(user.timezone);
  const conversationId = await activeConversationId(db, user.id);
  const history = await db.select().from(messages)
    .where(and(eq(messages.userId, user.id), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt)).limit(10);
  history.reverse();

  const [userMsg] = await db.insert(messages).values({ conversationId, userId: user.id, role: "USER", source, content: text }).returning();

  await ensureRecurringBills(db, user.id, today, user.timezone);

  let mode: "ai" | "rules" = "rules";
  let out;
  try {
    if (llmEnabled()) {
      const ctx = await buildContext(db, user, access, today);
      const turns: Turn[] = history.map((m) => ({ role: m.role === "USER" ? "user" : "assistant", content: m.content }));
      out = parseNinaOutput(await callNina(turns, JSON.stringify(ctx), text));
      mode = "ai";
    }
  } catch (e) {
    log.error("nina.llm_failed", { userId: user.id, error: e as Error });
  }
  if (!out) {
    const lastA = [...history].reverse().find((m) => m.role === "ASSISTANT");
    const lastU = [...history].reverse().find((m) => m.role === "USER");
    const cats = await loadCategories(db, user.id);
    const cards = (await cardsOverview(db, user.id, today)).map((c) => ({ ...c.card, usedCents: c.usedCents }));
    out = parseNinaOutput(fallbackNina(text, today, { lastAssistant: lastA?.content, lastUser: lastU?.content }, { family: !!access.household?.active, categories: cats.list, cards }));
  }

  const { allowed, note } = gateByPlan(plan, out.actions);
  const exec = await executeActions(db, access, today, allowed);

  // sugestão: resolve "new:N" para o id real agora, para executar com segurança depois
  let suggestion: Suggestion | null = out.suggestion;
  if (suggestion?.action) {
    const sa = suggestion.action;
    if (!hasFeature(plan, ACTION_FEATURE[sa.type])) suggestion = null;
    else if (sa.type === "set_event_reminder" && sa.ref.startsWith("new:")) {
      const id = exec.createdEventIds[Number(sa.ref.slice(4)) || 0];
      suggestion = id ? { ...suggestion, action: { ...sa, ref: id } } : null;
    }
  }

  const reply = note ? `${out.reply} ${note}` : out.reply;
  const [assistantMsg] = await db.insert(messages).values({
    conversationId, userId: user.id, role: "ASSISTANT", source: "SYSTEM", content: reply,
    actions: exec.executed, cards: exec.cards, suggestion, suggestionState: suggestion ? "PENDING" : null,
  }).returning();

  await countInteraction(db, user.id, usage.month);
  log.info("nina.message", { userId: user.id, mode, source, actions: exec.executed.map((a) => a.type), invalid: out.invalid, skipped: exec.skipped });

  return { user: toChatMessage(userMsg), assistant: toChatMessage(assistantMsg), mode };
}

/**
 * Resposta a um botão de sugestão. A ação vem do servidor (mensagem salva), nunca do cliente.
 * Sugestão sem ação (ex.: "Quer cadastrar a garantia?") → o cliente envia o "Sim" como nova mensagem.
 */
export async function answerSuggestion(db: DB, user: User, messageId: string, accept: boolean) {
  const [m] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.userId, user.id), eq(messages.suggestionState, "PENDING"))).limit(1);
  if (!m) throw new AppError(404, "Essa pergunta já foi respondida.", "not_found");
  const sg = m.suggestion as Suggestion;
  await db.update(messages).set({ suggestionState: accept ? "ACCEPTED" : "DECLINED" }).where(eq(messages.id, m.id));

  if (accept && !sg.action) return { followUp: sg.yes, messages: [] as ChatMessage[] };

  const today = todayIn(user.timezone);
  const [u] = await db.insert(messages).values({ conversationId: m.conversationId, userId: user.id, role: "USER", content: accept ? sg.yes : sg.no }).returning();
  let cards: Card[] = [];
  let reply = "Tudo bem! 👍";
  if (accept && sg.action) {
    const exec = await executeActions(db, await getAccess(db, user), today, [sg.action]);
    cards = exec.cards;
    reply = exec.executed.length ? "Combinado! Vou te lembrar. 🔔" : "Não consegui fazer isso agora. Pode me pedir de novo?";
  }
  const [a] = await db.insert(messages).values({ conversationId: m.conversationId, userId: user.id, role: "ASSISTANT", source: "SYSTEM", content: reply, cards }).returning();
  return { followUp: null, messages: [toChatMessage(u), toChatMessage(a)] };
}
