import { NextResponse, after } from "next/server";
import { getDb } from "@/db";
import { handleInbound, verifySignature, whatsappEnabled } from "@/lib/whatsapp";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Verificação do webhook (Meta → Configuração do webhook). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ok = u.searchParams.get("hub.mode") === "subscribe" && !!process.env.WHATSAPP_VERIFY_TOKEN
    && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok ? new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
}

/**
 * Mensagens recebidas. Responde 200 na hora e processa depois (after),
 * para a Meta não reenviar enquanto a Nina pensa.
 */
export async function POST(req: Request) {
  if (!whatsappEnabled()) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    log.warn("whatsapp.bad_signature");
    return new Response("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  after(async () => {
    try { await handleInbound(getDb(), payload as Parameters<typeof handleInbound>[1]); }
    catch (e) { log.error("whatsapp.inbound_failed", { error: e as Error }); }
  });
  return NextResponse.json({ ok: true });
}
