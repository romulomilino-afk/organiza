/**
 * Planos e limites. A regra vale no servidor: a interface só reflete.
 */
export type PlanId = "FREE" | "PREMIUM" | "FAMILY";
export type Feature = "agenda" | "tarefas" | "compras" | "lembretes" | "financeiro" | "memoria" | "documentos" | "garantias" | "assinaturas" | "audio" | "familia" | "whatsapp";

export const PLANS: Record<PlanId, { name: string; priceCents: number; monthlyInteractions: number; maxMembers: number; features: Feature[] }> = {
  FREE: {
    name: "Grátis", priceCents: 0, monthlyInteractions: 50, maxMembers: 1,
    features: ["agenda", "tarefas", "compras", "lembretes"],
  },
  PREMIUM: {
    name: "Premium", priceCents: 1990, monthlyInteractions: 2000, maxMembers: 1,
    features: ["agenda", "tarefas", "compras", "lembretes", "financeiro", "memoria", "documentos", "garantias", "assinaturas", "audio", "whatsapp"],
  },
  FAMILY: {
    name: "Família", priceCents: 2990, monthlyInteractions: 5000, maxMembers: 5,
    features: ["agenda", "tarefas", "compras", "lembretes", "financeiro", "memoria", "documentos", "garantias", "assinaturas", "audio", "whatsapp", "familia"],
  },
};

export function hasFeature(plan: PlanId, f: Feature): boolean {
  return PLANS[plan].features.includes(f);
}

/** Qual recurso cada ação da Nina exige. */
export const ACTION_FEATURE: Record<string, Feature> = {
  add_event: "agenda", update_event: "agenda", cancel_event: "agenda", set_event_reminder: "lembretes",
  add_task: "tarefas", complete_task: "tarefas", postpone_task: "tarefas",
  add_reminder: "lembretes", update_reminder: "lembretes", cancel_reminder: "lembretes",
  add_shopping: "compras", remove_shopping: "compras", check_shopping: "compras",
  add_transaction: "financeiro", add_bill: "financeiro", pay_bill: "financeiro",
  add_fixed: "financeiro", update_fixed: "financeiro", cancel_fixed: "financeiro",
  add_category: "financeiro", delete_category: "financeiro",
  add_deadline: "lembretes", complete_deadline: "lembretes", add_shopping_routine: "compras", cancel_shopping_routine: "compras",
  set_currency: "lembretes",
  add_card: "financeiro", update_card: "financeiro", delete_card: "financeiro", add_card_purchase: "financeiro", pay_invoice: "financeiro", cancel_card_purchase: "financeiro",
  add_subscription: "assinaturas", cancel_subscription: "assinaturas",
  add_warranty: "garantias", add_document: "documentos",
  remember: "memoria",
};

/** Plano de quem acabou de se cadastrar. Em produção é sempre o Grátis (com o teste de 7 dias). */
export function defaultPlan(): PlanId {
  if (process.env.NODE_ENV === "production") return "FREE";
  const p = process.env.DEFAULT_PLAN;
  return p === "PREMIUM" || p === "FAMILY" ? p : "FREE";
}

/** Teste grátis: quem está no Grátis usa tudo (como no plano Família) durante os primeiros dias. */
export const TRIAL_DAYS = 7;
export const TRIAL_PLAN: PlanId = "FAMILY";

export type Trial = { endsAt: Date; daysLeft: number; active: boolean };

/** Situação do teste de quem está no plano Grátis (null para quem paga ou nunca teve teste). */
export function trialInfo(plan: PlanId, trialEndsAt: Date | null | undefined, now = new Date()): Trial | null {
  if (plan !== "FREE" || !trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - now.getTime();
  return { endsAt: trialEndsAt, daysLeft: Math.max(0, Math.ceil(ms / 86_400_000)), active: ms > 0 };
}

/** Plano que vale de fato: Grátis em teste vira Família até o fim do teste. */
export function planWithTrial(plan: PlanId, trialEndsAt: Date | null | undefined, now = new Date()): PlanId {
  return trialInfo(plan, trialEndsAt, now)?.active ? TRIAL_PLAN : plan;
}
