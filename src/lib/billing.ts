/**
 * Pagamentos com Asaas (assinatura mensal).
 *
 * Dois jeitos de pagar:
 * - CREDIT_CARD (padrão): Asaas Checkout recorrente — o cliente digita o cartão NA PÁGINA DO ASAAS (o Organiza nunca vê
 *   os dados do cartão) e o Asaas cobra sozinho todo mês. A assinatura nasce no Asaas e é ligada ao usuário pelo webhook
 *   (pelo cliente/externalReference).
 * - PIX: assinatura mensal no Pix. Todo mês o Asaas gera uma cobrança Pix (QR Code e copia e cola) e avisa o cliente;
 *   o app também mostra um aviso quando o Pix do mês está para vencer.
 * - PIX_YEARLY: plano anual no Pix (12 meses com 10% de desconto), renovado uma vez por ano.
 * - UNDEFINED: (antigo) fatura mensal em que o cliente escolhe a forma de pagar.
 *
 * Fluxo: /planos → (Pix: nome e CPF) → checkout ou assinatura → webhook PAYMENT_CONFIRMED/RECEIVED → plano ativado.
 * O CPF/CNPJ vai direto para o Asaas e NÃO é guardado no nosso banco.
 */
import { and, desc, eq, like, lt, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { billingEvents, billingSubscriptions, users, type User } from "@/db/schema";
import { PLANS, yearlyCents, type PlanId } from "./plans";
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

/** Última assinatura cancelada (para mostrar até quando o acesso continua). */
export async function lastCanceled(db: DB, userId: string) {
  const [row] = await db.select().from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.userId, userId), eq(billingSubscriptions.status, "CANCELED")))
    .orderBy(desc(billingSubscriptions.updatedAt)).limit(1);
  return row ?? null;
}

export type PayMethod = "CREDIT_CARD" | "PIX" | "PIX_YEARLY" | "UNDEFINED";
export const isPix = (m: string) => m === "PIX" || m === "PIX_YEARLY";
/** Quantos meses cada pagamento cobre. */
export const periodMonths = (m: string) => (m === "PIX_YEARLY" ? 12 : 1);
/** Valor cobrado por pagamento, em centavos. */
export const chargeCents = (plan: "PREMIUM" | "FAMILY", m: PayMethod) => (m === "PIX_YEARLY" ? yearlyCents(plan) : PLANS[plan].priceCents);
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
export async function startCheckout(db: DB, user: User, plan: "PREMIUM" | "FAMILY", cpfCnpjRaw: string, method: PayMethod = "CREDIT_CARD", phoneRaw = "", nameRaw = ""): Promise<string> {
  if (!billingEnabled()) throw new AppError(501, "Pagamentos ainda não configurados.", "not_configured");
  const existing = await currentBilling(db, user.id);
  if (existing && existing.plan === plan && existing.status === "ACTIVE") throw new AppError(409, `Você já assina o ${PLANS[plan].name}.`, "already_active");
  // mesma escolha ainda pendente: reaproveita o link (o checkout do cartão expira em 60 minutos)
  const fresh = existing && Date.now() - existing.createdAt.getTime() < (CHECKOUT_MINUTES - 10) * 60_000;
  if (existing && existing.plan === plan && existing.status !== "ACTIVE" && existing.method === method && existing.lastInvoiceUrl && (method !== "CREDIT_CARD" || fresh)) return existing.lastInvoiceUrl;

  // Cartão: a própria página do Asaas pede CPF, celular e endereço do pagador (o checkout recusa
  // clientes com cadastro incompleto). Por isso não mandamos "customer"; a assinatura é ligada pelo webhook.
  const phone = cleanPhone(phoneRaw);
  let customerId = user.asaasCustomerId;
  if (method !== "CREDIT_CARD") {
    // Pix: o Asaas exige nome e CPF do pagador. O CPF vai direto para o Asaas (não guardamos).
    const cpfCnpj = cleanCpfCnpj(cpfCnpjRaw);
    if (!cpfCnpj) throw new AppError(400, "CPF ou CNPJ inválido. Confira os números.", "invalid_document");
    const name = nameRaw.trim().replace(/\s+/g, " ").slice(0, 100) || user.name || user.email;
    const data = { name, email: user.email, cpfCnpj, ...(phone ? { phone, mobilePhone: phone } : {}), externalReference: user.id, notificationDisabled: false };
    if (customerId) {
      const ok = await asaas(`/customers/${customerId}`, { method: "PUT", body: data }).then(() => true, () => false);
      if (!ok) customerId = null; // cliente antigo removido no Asaas: cria outro
    }
    if (!customerId) {
      const c = await asaas<{ id: string }>("/customers", { method: "POST", body: data });
      customerId = c.id;
      await db.update(users).set({ asaasCustomerId: customerId }).where(eq(users.id, user.id));
    }
  }

  // trocou de plano ou de forma de pagamento (e não está ativa): encerra a cobrança anterior
  if (existing && existing.status !== "ACTIVE") await cancelBilling(db, user, { immediate: existing.plan !== plan });
  else if (existing && existing.plan !== plan) await cancelBilling(db, user, { immediate: true });

  const cents = chargeCents(plan, method);
  const value = cents / 100;
  const today = todayIn(user.timezone);
  let providerId: string, link: string;

  if (method === "CREDIT_CARD") {
    const co = await asaas<{ id: string; link?: string | null }>("/checkouts", {
      method: "POST",
      body: {
        billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], minutesToExpire: CHECKOUT_MINUTES,
        externalReference: `${user.id}:${plan}`,
        callback: { successUrl: `${appUrl()}/planos?pago=1`, cancelUrl: `${appUrl()}/planos`, expiredUrl: `${appUrl()}/planos` },
        items: [{ name: `Meu Organiza ${PLANS[plan].name}`, description: "Assinatura mensal com cobrança automática no cartão", quantity: 1, value }],
        subscription: { cycle: "MONTHLY", nextDueDate: `${today} 00:00:00`, endDate: `${addMonths(today, 120)} 00:00:00` },
      },
    });
    providerId = `checkout:${co.id}`;
    link = co.link || `${checkoutHost()}/checkoutSession/show?id=${co.id}`;
  } else {
    const yearly = method === "PIX_YEARLY";
    const sub = await asaas<{ id: string }>("/subscriptions", {
      method: "POST",
      body: {
        customer: customerId, billingType: isPix(method) ? "PIX" : "UNDEFINED", value, cycle: yearly ? "YEARLY" : "MONTHLY",
        nextDueDate: today, description: `Meu Organiza ${PLANS[plan].name}${yearly ? " (anual)" : ""}`, externalReference: `${user.id}:${plan}`,
      },
    });
    const pays = await asaas<{ data: { invoiceUrl: string }[] }>(`/subscriptions/${sub.id}/payments`);
    const invoiceUrl = pays.data[0]?.invoiceUrl;
    if (!invoiceUrl) throw new AppError(502, "A fatura ainda não ficou pronta. Tente de novo em instantes.", "billing_error");
    providerId = sub.id; link = invoiceUrl;
  }

  await db.insert(billingSubscriptions).values({
    userId: user.id, providerSubscriptionId: providerId, plan, status: "PENDING", valueCents: cents, lastInvoiceUrl: link, method,
    nextDueDate: method === "CREDIT_CARD" ? null : today,
  });
  log.info("billing.checkout", { userId: user.id, plan, method });
  return link;
}

/** Pix: cobrança em aberto que vence em até `days` dias (ou já venceu). Para o aviso no app. */
export async function pixDue(db: DB, user: User, days = 3) {
  const b = await currentBilling(db, user.id);
  if (!b || !isPix(b.method) || !b.nextDueDate || !b.lastInvoiceUrl || b.status === "PENDING") return null;
  const today = todayIn(user.timezone);
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  if (b.nextDueDate > limit) return null;
  const daysLeft = Math.round((Date.parse(`${b.nextDueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return { plan: b.plan as PlanId, dueDate: b.nextDueDate, daysLeft, url: b.lastInvoiceUrl, valueCents: b.valueCents, yearly: b.method === "PIX_YEARLY" };
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
  payment?: { id: string; subscription?: string; customer?: string; dueDate?: string; invoiceUrl?: string; status?: string; externalReference?: string | null; billingType?: string; checkoutSession?: string | null };
  subscription?: { id: string; customer?: string; externalReference?: string | null; checkoutSession?: string | null };
  checkout?: { id: string; customer?: string | null; externalReference?: string | null };
};

const refUser = (ref?: string | null) => (ref && /^[\w-]+:(PREMIUM|FAMILY)$/.test(ref) ? ref.split(":")[0] : null);

/**
 * Assinatura criada pelo checkout de cartão: o id dela só aparece no webhook.
 * Liga ao nosso registro "checkout:<id>" pelo cliente do Asaas (ou pelo externalReference "userId:plano").
 */
async function linkCheckoutSubscription(db: DB, ev: AsaasEvent, subId: string) {
  const customer = ev.payment?.customer ?? ev.subscription?.customer ?? ev.checkout?.customer ?? null;
  // 1) externalReference "userId:plano"
  let userId: string | null = refUser(ev.payment?.externalReference) ?? refUser(ev.subscription?.externalReference);
  // 2) cliente do Asaas já conhecido
  if (!userId && customer) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.asaasCustomerId, customer)).limit(1);
    userId = u?.id ?? null;
  }
  // 3) id do checkout que gerou a cobrança
  const checkoutId = ev.payment?.checkoutSession ?? ev.subscription?.checkoutSession ?? null;
  if (!userId && checkoutId) {
    const [row] = await db.select({ userId: billingSubscriptions.userId }).from(billingSubscriptions).where(eq(billingSubscriptions.providerSubscriptionId, `checkout:${checkoutId}`)).limit(1);
    userId = row?.userId ?? null;
  }
  // 4) e-mail que a pessoa digitou no checkout (busca o cliente no Asaas)
  if (!userId && customer && billingEnabled()) {
    const c = await asaas<{ email?: string | null }>(`/customers/${customer}`).catch(() => null);
    const email = c?.email?.trim().toLowerCase();
    if (email) {
      const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      userId = u?.id ?? null;
    }
  }
  if (!userId) return null;
  if (customer) await db.update(users).set({ asaasCustomerId: customer }).where(eq(users.id, userId)); // quem pagou é o cliente que vale
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
  // eventos do próprio checkout: expirou/cancelou sem pagar, ou foi pago (guarda o cliente criado lá)
  if (ev.checkout?.id && ev.event.startsWith("CHECKOUT_")) {
    const [row] = await db.select().from(billingSubscriptions).where(eq(billingSubscriptions.providerSubscriptionId, `checkout:${ev.checkout.id}`)).limit(1);
    if (row && (ev.event === "CHECKOUT_EXPIRED" || ev.event === "CHECKOUT_CANCELED") && row.status === "PENDING") {
      await db.update(billingSubscriptions).set({ status: "CANCELED" }).where(eq(billingSubscriptions.id, row.id));
    }
    if (row && ev.checkout.customer) {
      await db.update(users).set({ asaasCustomerId: ev.checkout.customer }).where(eq(users.id, row.userId));
    }
    await db.update(billingEvents).set({ processedAt: new Date() }).where(eq(billingEvents.id, ev.id));
    return row ? "processed" : "ignored";
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
      const end = addMonths(due, periodMonths(b.method));
      const paidPending = !b.nextDueDate || b.nextDueDate <= due; // a cobrança em aberto foi esta (ou uma anterior)
      await db.update(billingSubscriptions).set({
        status: "ACTIVE", overdueSince: null,
        currentPeriodEnd: b.currentPeriodEnd && b.currentPeriodEnd > end ? b.currentPeriodEnd : end,
        ...(paidPending ? { nextDueDate: null, lastInvoiceUrl: ev.payment?.invoiceUrl ?? b.lastInvoiceUrl } : {}),
      }).where(eq(billingSubscriptions.id, b.id));
      await db.update(users).set({ plan: b.plan }).where(eq(users.id, b.userId));
      log.info("billing.activated", { userId: b.userId, plan: b.plan });
      break;
    }
    case "PAYMENT_CREATED":
      // Pix: nova cobrança do mês (ou do ano) gerada; guardamos o link e o vencimento para avisar no app
      await db.update(billingSubscriptions).set({
        lastInvoiceUrl: ev.payment?.invoiceUrl ?? b.lastInvoiceUrl,
        ...(isPix(b.method) && ev.payment?.dueDate ? { nextDueDate: ev.payment.dueDate } : {}),
      }).where(eq(billingSubscriptions.id, b.id));
      break;
    case "PAYMENT_OVERDUE":
      await db.update(billingSubscriptions).set({ status: "OVERDUE", overdueSince: b.overdueSince ?? today, lastInvoiceUrl: ev.payment?.invoiceUrl ?? b.lastInvoiceUrl, ...(isPix(b.method) && ev.payment?.dueDate ? { nextDueDate: ev.payment.dueDate } : {}) })
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

