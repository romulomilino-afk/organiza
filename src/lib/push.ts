/**
 * Envio de notificações Web Push (padrão VAPID; funciona em Chrome, Edge, Firefox,
 * Android e iPhone/iPad com o app instalado na tela inicial, iOS 16.4+).
 */
import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { log } from "./logger";

let configured = false;
export function pushEnabled(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
function configure() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@organiza.app", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Envia para todos os aparelhos do usuário. Inscrições expiradas são removidas. Retorna quantos receberam. */
export async function sendPush(db: DB, userId: string, payload: PushPayload): Promise<number> {
  if (!pushEnabled()) return 0;
  configure();
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  let ok = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: "normal" });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
      else log.warn("push.failed", { userId, status: code });
    }
  }));
  if (dead.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
  return ok;
}
