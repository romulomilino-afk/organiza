/**
 * Pagamentos com Asaas (assinatura mensal).
 *
 * Dois jeitos de pagar:
 * - CREDIT_CARD (padrão): Asaas Checkout recorrente — o cliente digita o cartão NA PÁGINA DO ASAAS (o Organiza nunca vê
 *   os dados do cartão) e o Asaas cobra sozinho todo mês. A assinatura nasce no Asaas e é ligada ao usuário pelo webhook
 *   (pelo cliente/externalReference).
 * - UNDEFINED: assinatura com fatura mensal; o cliente escolhe Pix, boleto ou cartão a cada mês.
 *
 * Fluxo: /planos → CPF/CNPJ → cria cliente → checkout (ou assinatura) → webhook PAYMENT_CONFIRMED/RECEIVED → plano ativado.
 * O CPF/CNPJ vai direto para o Asaas e NÃO é guardado no nosso banco.
 */
import { and, desc, eq, like, lt, ne } from "drizzle-orm";
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

export type PayMethod = "CREDIT_CARD" | "UNDEFINED";
const checkoutHost = () => (process.env.ASAAS_ENV === "production" ? "https://www.asaas.com" : "https://sandbox.asaas.com");
const appUrl = () => (process.env.AUTH_URL || process.env.URL || "http://localhost:3000").replace(/\/$/, "");
const CHECKOUT_MINUTES = 60;

/** Celular brasileiro com DDD (10 ou 11 dígitos, aceita +55). Retorna só os dígitos sem o 55, ou null. */
export function cleanPhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^(\d)\1+$/.test(d) || Number(d.slice(0, 2)) < 11) return null;
  return d;
}

/** Cria (ou reaproveita) a cobrança e devolve o link de pagamento do Asaas. */
export async function startCheckout(db: DB, user: User, plan: "PREMIUM" | "FAMILY", cpfCnpjRaw: string, method: PayMethod = "CREDIT_CARD", phoneRaw = ""): Promise<string> {
  if (!billingEnabled()) throw new AppError(501, "Pagamentos ainda não configurados.", "not_configured");
  const existing = await currentBilling(db, user.id);
  if (existing && existing.plan === plan && existing.status === "ACTIVE") throw new AppError(409, `Você já assina o ${PLANS[plan].name}.`, "already_active");
  // mesma escolha ainda pendente: reaproveita o link (o checkout do cartão expira em 60 minutos)
  const fresh = existing && Date.now() - existing.createdAt.getTime() < (CHECKOUT_MINUTES - 10) * 60_000;
  if (existing && existing.plan === plan && existing.status !== "ACTIVE" && existing.method === method && existing.lastInvoiceUrl && (method === "UNDEFINED" || fresh)) return existing.lastInvoiceUrl;

  // o checkout com cartão exige o celular do cliente no Asaas (não guardamos aqui)
  const phone = cleanPhone(phoneRaw);
  if (method === "CREDIT_CARD" && !phone) throw new AppError(400, "Informe um celular válido com DDD, ex.: (21) 99999-0000.", "invalid_phone");

  let customerId = user.asaasCustomerId;
  if (!customerId) {
    const cpfCnpj = cleanCpfCnpj(cpfCnpjRaw);
    if (!cpfCnpj) throw new AppError(400, "CPF ou CNPJ inválido. Confira os números.", "invalid_document");
    const c = await asaas<{ id: string }>("/customers", {
      method: "POST", body: { name: user.name || user.email, email: user.email, cpfCnpj, ...(phone ? { phone, mobilePhone: phone } : {}), externalReference: user.id, notificationDisabled: false },
    });
    customerId = c.id;
    await db.update(users).set({ asaasCustomerId: customerId }).where(eq(users.id, user.id));
  } else if (phone) {
    await asaas(`/customers/${customerId}`, { method: "PUT", body: { phone, mobilePhone: phone } });
  }

  // trocou de plano ou de forma de pagamento (e não está ativa): encerra a cobrança anterior
  if (existing && existing.status !== "ACTIVE") await cancelBilling(db, user, { immediate: existing.plan !== plan });
  else if (existing && existing.plan !== plan) await cancelBilling(db, user, { immediate: true });

  const value = PLANS[plan].priceCents / 100;
  const today = todayIn(user.timezone);
  let providerId: string, link: string;

  if (method === "CREDIT_CARD") {
    const co = await asaas<{ id: string; link?: string | null }>("/checkouts", {
      method: "POST",
      body: {
        billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], minutesToExpire: CHECKOUT_MINUTES,
        customer: customerId, externalReference: `${user.id}:${plan}`,
        callback: { successUrl: `${appUrl()}/planos?pago=1`, cancelUrl: `${appUrl()}/planos`, expiredUrl: `${appUrl()}/planos` },
        items: [{ name: `Meu Organiza ${PLANS[plan].name}`, description: "Assinatura mensal com cobrança automática no cartão", quantity: 1, value }],
        subscription: { cycle: "MONTHLY", nextDueDate: `${today} 00:00:00`, endDate: `${addMonths(today, 120)} 00:00:00` },
      },
    });
    providerId = `checkout:${co.id}`;
    link = co.link || `${checkoutHost()}/checkoutSession/show?id=${co.id}`;
  } else {
    const sub = await asaas<{ id: string }>("/subscriptions", {
      method: "POST",
      body: {
        customer: customerId, billingType: "UNDEFINED", value, cycle: "MONTHLY",
        nextDueDate: today, description: `Meu Organiza ${PLANS[plan].name}`, externalReference: `${user.id}:${plan}`,
      },
    });
    const pays = await asaas<{ data: { invoiceUrl: string }[] }>(`/subscriptions/${sub.id}/payments`);
    const invoiceUrl = pays.data[0]?.invoiceUrl;
    if (!invoiceUrl) throw new AppError(502, "A fatura ainda não ficou pronta. Tente de novo em instantes.", "billing_error");
    providerId = sub.id; link = invoiceUrl;
  }

  await db.insert(billingSubscriptions).values({
    userId: user.id, providerSubscriptionId: providerId, plan, status: "PENDING", valueCents: PLANS[plan].priceCents, lastInvoiceUrl: link, method,
  });
  log.info("billing.checkout", { userId: user.id, plan, method });
  return link;
}

/** Cancela no Asaas. O acesso continua até o fim do período já pago (a não ser que immediate). */
export async function cancelBilling(db: DB, user: User, opts: { immediate?: boolean } = {}) {
  const b = await currentBilling(db, user.id);
  if (!b) return;
  // checkout de cartão ainda não pago não tem assinatura no Asaas para apagar
  if (billingEnabled() && !b.providerSubscriptionId.startsWith("checkout:")) await asaas(`/subscriptions/${b.providerSubscriptionId}`, { method: "DELETE" }).catch(() => undefined);
  await db.update(billingSubscriptions).set({ status: "CANCELED" }).where(eq(billingSubscriptions.id, b.id));
  if (b.status === "PENDING") return; // nunca foi paga: não mexe no plano atual da pessoa
  const today = todayIn(user.timezone);
  if (opts.immediate || !b.currentPeriodEnd || b.currentPeriodEnd < today) await db.update(users).set({ plan: "FREE" }).where(eq(users.id, user.id));
  log.info("billing.canceled", { userId: user.id, plan: b.plan });
}

type AsaasEvent = {
  id: string; event: string;
  payment?: { id: string; subscription?: string; customer?: string; dueDate?: string; invoiceUrl?: string; status?: string; externalReference?: string | null; billingType?: string };
  subscription?: { id: string; customer?: string; externalReference?: string | null };
  checkout?: { id: string; customer?: string | null; externalReference?: string | null };
};

/**
 * Assinatura criada pelo checkout de cartão: o id dela só aparece no webhook.
 * Liga ao nosso registro "checkout:<id>" pelo cliente do Asaas (ou pelo externalReference "userId:plano").
 */
async function linkCheckoutSubscription(db: DB, ev: AsaasEvent, subId: string) {
  const customer = ev.payment?.customer ?? ev.subscription?.customer ?? ev.checkout?.customer ?? null;
  const ref = ev.payment?.externalReference ?? ev.subscription?.externalReference ?? null;
  let userId: string | null = ref && /^[\w-]+:(PREMIUM|FAMILY)$/.test(ref) ? ref.split(":")[0] : null;
  if (!userId && customer) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.asaasCustomerId, customer)).limit(1);
    userId = u?.id ?? null;
  }
  if (!userId) return null;
  const [pending] = await db.select().from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.userId, userId), like(billingSubscriptions.providerSubscriptionId, "checkout:%"), ne(billingSubscriptions.status, "CANCELED")))
    .orderBy(desc(billingSubscriptions.createdAt)).limit(1);
  if (!pending) return null;
  const [linked] = await db.update(billingSubscriptions).set({ providerSubscriptionId: subId }).where(eq(billingSubscriptions.id, pending.id)).returning();
  log.info("billing.checkout_linked", { userId });
  return linked;
}

/** Processa um evento do webhook. Idempotente pelo id do evento. */
export async function handleAsaasEvent(db: DB, ev: AsaasEvent): Promise<"duplicate" | "ignored" | "processed"> {
  const inserted = await db.insert(billingEvents).values({ id: ev.id, provider: "asaas", type: ev.event }).onConflictDoNothing().returning();
  if (!inserted.length) {
    const [prev] = await db.select().from(billingEvents).where(eq(billingEvents.id, ev.id));
    if (prev?.processedAt) return "duplicate";
  }
  const subId = ev.payment?.subscription ?? ev.subscription?.id;
  let [b] = subId ? await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.providerSubscriptionId, subId)).limit(1) : [];
  if (!b && subId) {
    const linked = await linkCheckoutSubscription(db, ev, subId);
    if (linked) b = linked;
  }
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

