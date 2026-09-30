/**
 * Pagamentos com Asaas (assinatura mensal; o cliente escolhe Pix, boleto ou cartão na fatura).
 *
 * Fluxo: /planos → CPF/CNPJ → cria cliente + assinatura no Asaas → redireciona para a fatura
 *        → webhook PAYMENT_CONFIRMED/RECEIVED → plano ativado.
 * O CPF/CNPJ vai direto para o Asaas e NÃO é guardado no nosso banco.
 */
import { and, eq, lt, ne } from "drizzle-orm";
import type { DB } from "@/db";
import { billingEvents, billingSubscriptions, users, type User } from "@/db/schema";
import { PLANS, type PlanId } from "./plans";
import { addMonths, todayIn } from "./dates";
import { AppError } from "./errors";
import { log } from "./logger";

export function billingEnabled() {
  return !!process.env.ASAAS_API_KEY;
}
function baseUrl() {
  return process.env.ASAAS_ENV === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
}

async function asaas<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(baseUrl() + path, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", "User-Agent": "Organiza", access_token: process.env.ASAAS_API_KEY! },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const desc = (data as { errors?: { description?: string }[] }).errors?.[0]?.description;
    log.error("asaas.error", { path: path.split("/")[1], status: res.status });
    throw new AppError(res.status === 400 ? 400 : 502, desc ?? "Não consegui falar com o sistema de pagamento. Tente de novo.", "billing_error");
  }
  return data as T;
}

/** Valida CPF (11) ou CNPJ (14) pelos dígitos verificadores. Retorna só os dígitos ou null. */
export function cleanCpfCnpj(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (/^(\d)\1+$/.test(d)) return null;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((a, n, i) => a + Number(n) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2], w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const v1 = (() => { const s = d.slice(0, 9).split("").reduce((a, n, i) => a + Number(n) * w1[i], 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; })();
    const v2 = (() => { const s = d.slice(0, 10).split("").reduce((a, n, i) => a + Number(n) * w2[i], 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; })();
    return v1 === Number(d[9]) && v2 === Number(d[10]) ? d : null;
  }
  if (d.length === 14) {
    const v1 = calc(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const v2 = calc(d.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return v1 === Number(d[12]) && v2 === Number(d[13]) ? d : null;
  }
  return null;
}

export async function currentBilling(db: DB, userId: string) {
  const [row] = await db.select().from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.userId, userId), ne(billingSubscriptions.status, "CANCELED")))
    .orderBy(billingSubscriptions.createdAt).limit(1);
  return row ?? null;
}

/** Cria (ou reaproveita) a assinatura e devolve o link da fatura. */
export async function startCheckout(db: DB, user: User, plan: "PREMIUM" | "FAMILY", cpfCnpjRaw: string): Promise<string> {
  if (!billingEnabled()) throw new AppError(501, "Pagamentos ainda não configurados.", "not_configured");
  const existing = await currentBilling(db, user.id);
  if (existing && existing.plan === plan && existing.lastInvoiceUrl && existing.status !== "ACTIVE") return existing.lastInvoiceUrl;
  if (existing && existing.plan === plan && existing.status === "ACTIVE") throw new AppError(409, `Você já assina o ${PLANS[plan].name}.`, "already_active");

  let customerId = user.asaasCustomerId;
  if (!customerId) {
    const cpfCnpj = cleanCpfCnpj(cpfCnpjRaw);
    if (!cpfCnpj) throw new AppError(400, "CPF ou CNPJ inválido. Confira os números.", "invalid_document");
    const c = await asaas<{ id: string }>("/customers", {
      method: "POST", body: { name: user.name || user.email, email: user.email, cpfCnpj, externalReference: user.id, notificationDisabled: false },
    });
    customerId = c.id;
    await db.update(users).set({ asaasCustomerId: customerId }).where(eq(users.id, user.id));
  }

  // trocando de plano: encerra a assinatura anterior
  if (existing && existing.plan !== plan) await cancelBilling(db, user, { immediate: true });

  const value = PLANS[plan].priceCents / 100;
  const sub = await asaas<{ id: string }>("/subscriptions", {
    method: "POST",
    body: {
      customer: customerId, billingType: "UNDEFINED", value, cycle: "MONTHLY",
      nextDueDate: todayIn(user.timezone), description: `Organiza ${PLANS[plan].name}`, externalReference: user.id,
    },
  });
  const pays = await asaas<{ data: { invoiceUrl: string }[] }>(`/subscriptions/${sub.id}/payments`);
  const invoiceUrl = pays.data[0]?.invoiceUrl;
  if (!invoiceUrl) throw new AppError(502, "A fatura ainda não ficou pronta. Tente de novo em instantes.", "billing_error");

  await db.insert(billingSubscriptions).values({
    userId: user.id, providerSubscriptionId: sub.id, plan, status: "PENDING", valueCents: PLANS[plan].priceCents, lastInvoiceUrl: invoiceUrl,
  });
  log.info("billing.checkout", { userId: user.id, plan });
  return invoiceUrl;
}

/** Cancela no Asaas. O acesso continua até o fim do período já pago (a não ser que immediate). */
export async function cancelBilling(db: DB, user: User, opts: { immediate?: boolean } = {}) {
  const b = await currentBilling(db, user.id);
  if (!b) return;
  if (billingEnabled()) await asaas(`/subscriptions/${b.providerSubscriptionId}`, { method: "DELETE" }).catch(() => undefined);
  await db.update(billingSubscriptions).set({ status: "CANCELED" }).where(eq(billingSubscriptions.id, b.id));
  const today = todayIn(user.timezone);
  if (opts.immediate || !b.currentPeriodEnd || b.currentPeriodEnd < today) await db.update(users).set({ plan: "FREE" }).where(eq(users.id, user.id));
  log.info("billing.canceled", { userId: user.id, plan: b.plan });
}

type AsaasEvent = {
  id: string; event: string;
  payment?: { id: string; subscription?: string; dueDate?: string; invoiceUrl?: string; status?: string };
  subscription?: { id: string };
};

/** Processa um evento do webhook. Idempotente pelo id do evento. */
export async function handleAsaasEvent(db: DB, ev: AsaasEvent): Promise<"duplicate" | "ignored" | "processed"> {
  const inserted = await db.insert(billingEvents).values({ id: ev.id, provider: "asaas", type: ev.event }).onConflictDoNothing().returning();
  if (!inserted.length) {
    const [prev] = await db.select().from(billingEvents).where(eq(billingEvents.id, ev.id));
    if (prev?.processedAt) return "duplicate";
  }
  const subId = ev.payment?.subscription ?? ev.subscription?.id;
  const [b] = subId ? await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.providerSubscriptionId, subId)).limit(1) : [];
  if (!b) {
    await db.update(billingEvents).set({ processedAt: new Date() }).where(eq(billingEvents.id, ev.id));
    return "ignored";
  }
  const today = new Date().toISOString().slice(0, 10);
  switch (ev.event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED": {
      const due = ev.payment?.dueDate ?? today;
      await db.update(billingSubscriptions).set({ status: "ACTIVE", overdueSince: null, currentPeriodEnd: addMonths(due, 1), lastInvoiceUrl: ev.payment?.invoiceUrl ?? b.lastInvoiceUrl })
        .where(eq(billingSubscriptions.id, b.id));
      await db.update(users).set({ plan: b.plan }).where(eq(users.id, b.userId));
      log.info("billing.activated", { userId: b.userId, plan: b.plan });
      break;
    }
    case "PAYMENT_CREATED":
      await db.update(billingSubscriptions).set({ lastInvoiceUrl: ev.payment?.invoiceUrl ?? b.lastInvoiceUrl }).where(eq(billingSubscriptions.id, b.id));
      break;
    case "PAYMENT_OVERDUE":
      await db.update(billingSubscriptions).set({ status: "OVERDUE", overdueSince: b.overdueSince ?? today, lastInvoiceUrl: ev.payment?.invoiceUrl ?? b.lastInvoiceUrl })
        .where(eq(billingSubscriptions.id, b.id));
      break;
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
      await db.update(billingSubscriptions).set({ status: "CANCELED" }).where(eq(billingSubscriptions.id, b.id));
      await db.update(users).set({ plan: "FREE" }).where(eq(users.id, b.userId));
      break;
    case "SUBSCRIPTION_DELETED":
    case "SUBSCRIPTION_INACTIVATED":
      await db.update(billingSubscriptions).set({ status: "CANCELED" }).where(eq(billingSubscriptions.id, b.id));
      break;
  }
  await db.update(billingEvents).set({ processedAt: new Date() }).where(eq(billingEvents.id, ev.id));
  return "processed";
}

const GRACE_DAYS = 7;

/** Diariamente: rebaixa quem está inadimplente há mais de 7 dias ou cujo período cancelado acabou. */
export async function runBillingMaintenance(db: DB, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const graceLimit = new Date(now.getTime() - GRACE_DAYS * 86_400_000).toISOString().slice(0, 10);
  let downgraded = 0;
  const overdue = await db.select().from(billingSubscriptions).where(and(eq(billingSubscriptions.status, "OVERDUE"), lt(billingSubscriptions.overdueSince, graceLimit)));
  const ended = await db.select().from(billingSubscriptions).where(and(eq(billingSubscriptions.status, "CANCELED"), lt(billingSubscriptions.currentPeriodEnd, today)));
  for (const b of [...overdue, ...ended]) {
    const [active] = await db.select().from(billingSubscriptions).where(and(eq(billingSubscriptions.userId, b.userId), eq(billingSubscriptions.status, "ACTIVE"))).limit(1);
    if (active) continue;
    const r = await db.update(users).set({ plan: "FREE" }).where(and(eq(users.id, b.userId), eq(users.plan, b.plan as PlanId))).returning({ id: users.id });
    downgraded += r.length;
  }
  if (downgraded) log.info("billing.downgraded", { count: downgraded });
  return { downgraded };
}

