/**
 * Meta (Facebook/Instagram Ads): API de Conversões, os eventos enviados pelo servidor.
 * O pixel do navegador (components/MetaPixel.tsx) manda os mesmos eventos com o mesmo event_id,
 * e o Meta junta os dois (deduplicação).
 *
 * Sem META_CAPI_TOKEN no ambiente, nada é enviado. O token é secreto: só no painel do Netlify.
 * E-mail e id do usuário vão com hash SHA-256, como o Meta exige.
 */
import { createHash } from "node:crypto";
import { log } from "./logger";

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "2373483593414905";
const SITE = process.env.AUTH_URL || "https://meuorganiza.com.br";

export type MetaEventName = "Lead" | "CompleteRegistration" | "StartTrial" | "Subscribe" | "Purchase" | "InitiateCheckout";

const sha = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

export type MetaEventInput = {
  name: MetaEventName;
  eventId: string;
  userId?: string;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  url?: string;
  valueCents?: number;
  currency?: string;
};

/** Monta o corpo do evento (puro, testável). */
export function metaPayload(e: MetaEventInput, now = Date.now()) {
  const user_data: Record<string, unknown> = {};
  if (e.email) user_data.em = [sha(e.email)];
  if (e.userId) user_data.external_id = [sha(e.userId)];
  if (e.ip) user_data.client_ip_address = e.ip;
  if (e.userAgent) user_data.client_user_agent = e.userAgent;
  if (e.fbp) user_data.fbp = e.fbp;
  if (e.fbc) user_data.fbc = e.fbc;
  const custom_data = e.valueCents != null ? { value: Math.round(e.valueCents) / 100, currency: e.currency ?? "BRL" } : undefined;
  return {
    data: [{
      event_name: e.name, event_time: Math.floor(now / 1000), event_id: e.eventId,
      action_source: "website", event_source_url: e.url ?? SITE, user_data,
      ...(custom_data ? { custom_data } : {}),
    }],
    ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
  };
}

/** Envia um evento. Nunca derruba o fluxo que chamou: erro só vai para o log. */
export async function sendMetaEvent(e: MetaEventInput): Promise<boolean> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metaPayload(e)), signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) { log.warn("meta.event_failed", { event: e.name, status: res.status }); return false; }
    log.info("meta.event_sent", { event: e.name });
    return true;
  } catch (err) {
    log.warn("meta.event_error", { event: e.name, error: String(err).slice(0, 120) });
    return false;
  }
}

/** Lê ip, navegador e os cookies _fbp/_fbc de uma requisição. */
export function requestContext(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const get = (n: string) => cookie.match(new RegExp(`(?:^|;\\s*)${n}=([^;]+)`))?.[1] ?? null;
  return {
    ip: req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent"),
    fbp: get("_fbp"), fbc: get("_fbc"),
  };
}
