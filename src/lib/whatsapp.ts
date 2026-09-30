/**
 * Nina no WhatsApp (WhatsApp Cloud API, oficial da Meta).
 *
 * - Vínculo do número: o usuário gera um código de 6 dígitos no app e manda para o número do Organiza.
 *   Quem manda a mensagem prova que tem o número — sem SMS, sem template.
 * - Texto e áudio viram mensagens para a Nina (mesmo orquestrador do app).
 * - Sugestões ("Quer que eu te lembre 1 dia antes?") viram botões de resposta.
 * - Cada mensagem é processada uma única vez (tabela whatsapp_inbound).
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { DB } from "@/db";
import { users, whatsappInbound, whatsappLinkCodes, type User } from "@/db/schema";
import { answerSuggestion, handleMessage, type ChatMessage } from "./nina";
import { getAccess } from "./access";
import { hasFeature } from "./plans";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";
import { transcribe } from "./stt";
import { log } from "./logger";

// ─────────────── Cliente da Graph API ───────────────
export type WaButton = { id: string; title: string };
export interface WhatsAppClient {
  sendText(to: string, body: string): Promise<void>;
  sendButtons(to: string, body: string, buttons: WaButton[]): Promise<void>;
  downloadMedia(mediaId: string): Promise<{ data: Blob; mime: string } | null>;
}

export function whatsappEnabled() {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_APP_SECRET);
}

const graph = (path: string) => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || "v22.0"}/${path}`;

export const graphClient: WhatsAppClient = {
  async sendText(to, body) {
    await post({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4000), preview_url: false } });
  },
  async sendButtons(to, body, buttons) {
    await post({
      messaging_product: "whatsapp", to, type: "interactive",
      interactive: { type: "button", body: { text: body.slice(0, 1024) }, action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
    });
  },
  async downloadMedia(mediaId) {
    const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
    const meta = await fetch(graph(mediaId), { headers: auth });
    if (!meta.ok) return null;
    const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
    if (!url) return null;
    const file = await fetch(url, { headers: auth });
    if (!file.ok) return null;
    return { data: await file.blob(), mime: mime_type ?? "audio/ogg" };
  },
};

async function post(body: unknown) {
  const res = await fetch(graph(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`), {
    method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) log.error("whatsapp.send_failed", { status: res.status });
}

/** Confere X-Hub-Signature-256 sobre o corpo bruto (em tempo constante). */
export function verifySignature(rawBody: string, header: string | null, secret = process.env.WHATSAPP_APP_SECRET ?? ""): boolean {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice(7), "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─────────────── Vínculo do número ───────────────
export async function createLinkCode(db: DB, userId: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = String(randomInt(100000, 1000000));
    try {
      await db.insert(whatsappLinkCodes).values({ userId, code, expiresAt: new Date(Date.now() + 15 * 60_000) })
        .onConflictDoUpdate({ target: whatsappLinkCodes.userId, set: { code, expiresAt: new Date(Date.now() + 15 * 60_000), attempts: 0 } });
      return code;
    } catch { /* código repetido: tenta outro */ }
  }
  throw new AppError(500, "Não consegui gerar o código. Tente de novo.", "code_failed");
}

export async function unlinkPhone(db: DB, userId: string) {
  await db.update(users).set({ phone: null, phoneVerifiedAt: null }).where(eq(users.id, userId));
}

async function tryLink(db: DB, phone: string, text: string): Promise<User | null> {
  const m = text.match(/\b(\d{6})\b/);
  if (!m) return null;
  const [row] = await db.select().from(whatsappLinkCodes).where(and(eq(whatsappLinkCodes.code, m[1]), gt(whatsappLinkCodes.expiresAt, new Date()))).limit(1);
  if (!row) return null;
  // o número passa a ser desta conta (se estava em outra, sai de lá)
  await db.update(users).set({ phone: null, phoneVerifiedAt: null }).where(eq(users.phone, phone));
  const [u] = await db.update(users).set({ phone, phoneVerifiedAt: new Date() }).where(eq(users.id, row.userId)).returning();
  await db.delete(whatsappLinkCodes).where(eq(whatsappLinkCodes.userId, row.userId));
  log.info("whatsapp.linked", { userId: row.userId });
  return u ?? null;
}

// ─────────────── Formatação ───────────────
export function formatReply(m: ChatMessage): string {
  const parts = [m.content];
  for (const c of m.cards) parts.push(`*${c.icon} ${c.title}*${c.lines.length ? "\n" + c.lines.join("\n") : ""}`);
  return parts.join("\n\n");
}

async function deliver(wa: WhatsAppClient, to: string, m: ChatMessage) {
  const text = formatReply(m);
  if (m.suggestion) {
    await wa.sendText(to, text);
    await wa.sendButtons(to, m.suggestion.text, [{ id: `sg:${m.id}:1`, title: m.suggestion.yes }, { id: `sg:${m.id}:0`, title: m.suggestion.no }]);
  } else await wa.sendText(to, text);
}

// ─────────────── Mensagens recebidas ───────────────
type WaMessage = {
  id: string; from: string; type: string;
  text?: { body?: string };
  audio?: { id: string; mime_type?: string };
  interactive?: { type: string; button_reply?: { id: string; title: string } };
  button?: { payload?: string; text?: string };
};
type WaPayload = { entry?: { changes?: { field?: string; value?: { messages?: WaMessage[] } }[] }[] };

export function extractMessages(payload: WaPayload): WaMessage[] {
  const out: WaMessage[] = [];
  for (const e of payload.entry ?? []) for (const c of e.changes ?? []) if (c.field === "messages") out.push(...(c.value?.messages ?? []));
  return out;
}

export async function handleInbound(db: DB, payload: WaPayload, wa: WhatsAppClient = graphClient) {
  for (const msg of extractMessages(payload)) {
    const fresh = await db.insert(whatsappInbound).values({ wamid: msg.id }).onConflictDoNothing().returning();
    if (!fresh.length) continue; // já processada (a Meta reenvia)
    const phone = msg.from.replace(/\D/g, "");
    try {
      await handleOne(db, wa, phone, msg);
    } catch (e) {
      if (e instanceof AppError) await wa.sendText(phone, e.publicMessage);
      else { log.error("whatsapp.failed", { error: e as Error }); await wa.sendText(phone, "Tive um problema agora. Pode repetir daqui a pouco?"); }
    }
  }
}

async function handleOne(db: DB, wa: WhatsAppClient, phone: string, msg: WaMessage) {
  let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  const text = msg.text?.body?.trim() ?? "";

  if (!user) {
    const linked = text ? await tryLink(db, phone, text) : null;
    if (linked) {
      const first = linked.name?.split(" ")[0];
      await wa.sendText(phone, `Pronto${first ? `, ${first}` : ""}! 🎉 Seu WhatsApp está conectado ao Organiza.\n\nAgora é só me mandar mensagem ou áudio: "Gastei 45 no almoço", "Tenho dentista dia 20 às 14h"…`);
      return;
    }
    if (rateLimit(`wa-unknown:${phone}`, 1, 60 * 60_000)) {
      await wa.sendText(phone, "Oi! Eu sou a Nina, do Organiza. 😊\nPara conversar comigo por aqui, abra o app em *Minha conta → WhatsApp*, gere seu código e me mande os 6 números.");
    }
    return;
  }

  const access = await getAccess(db, user);
  if (!hasFeature(access.plan, "whatsapp")) {
    await wa.sendText(phone, "Conversar com a Nina pelo WhatsApp faz parte do plano Premium. Você pode assinar em Organiza → Planos. 💚");
    return;
  }
  if (!rateLimit(`wa:${user.id}`, 20, 60_000)) return;

  // botão de sugestão
  const buttonId = msg.interactive?.button_reply?.id ?? msg.button?.payload;
  if (buttonId?.startsWith("sg:")) {
    const [, messageId, yes] = buttonId.split(":");
    const r = await answerSuggestion(db, user, messageId, yes === "1");
    if (r.followUp) {
      const res = await handleMessage(db, user, r.followUp, "TEXT", access);
      await deliver(wa, phone, res.assistant);
    } else {
      const last = r.messages.find((m) => m.role === "ASSISTANT");
      if (last) await deliver(wa, phone, last);
    }
    return;
  }

  let input = text, source: "TEXT" | "VOICE" = "TEXT", heard = "";
  if (msg.type === "audio" && msg.audio) {
    if (!hasFeature(access.plan, "audio")) { await wa.sendText(phone, "Mensagens de áudio fazem parte do plano Premium. Por enquanto, me escreva. ✍️"); return; }
    const media = await wa.downloadMedia(msg.audio.id);
    const t = media ? await transcribe(media.data, "audio.ogg") : null;
    if (!t) { await wa.sendText(phone, "Não consegui entender o áudio. Pode escrever ou mandar de novo?"); return; }
    input = t; source = "VOICE"; heard = `🎙️ _${t}_\n\n`;
  }
  if (!input) {
    if (msg.type !== "reaction") await wa.sendText(phone, "Por enquanto eu entendo texto e áudio. 😊");
    return;
  }
  if (/^(desconectar|sair do organiza)$/i.test(input)) {
    await unlinkPhone(db, user.id);
    await wa.sendText(phone, "Seu WhatsApp foi desconectado do Organiza. Até logo! 👋");
    return;
  }

  const res = await handleMessage(db, user, input, source, access);
  const m = { ...res.assistant, content: heard + res.assistant.content };
  await deliver(wa, phone, m);
}
