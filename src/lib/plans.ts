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
    name: "Premium", priceCents: 1490, monthlyInteractions: 2000, maxMembers: 1,
    features: ["agenda", "tarefas", "compras", "lembretes", "financeiro", "memoria", "documentos", "garantias", "assinaturas", "audio", "whatsapp"],
  },
  FAMILY: {
    name: "Família", priceCents: 2490, monthlyInteractions: 5000, maxMembers: 5,
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

export function defaultPlan(): PlanId {
  const p = process.env.DEFAULT_PLAN;
  return p === "PREMIUM" || p === "FAMILY" ? p : "FREE";
}
