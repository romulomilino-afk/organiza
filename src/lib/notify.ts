/**
 * O "vigia" da Nina: roda a cada poucos minutos (cron) e decide o que notificar.
 *
 * Regras para não incomodar:
 * - nada no horário de silêncio (padrão 22h–7h), exceto lembretes com horário que o próprio usuário marcou;
 * - cada coisa é avisada uma vez só (dedupe_key em notifications);
 * - no máximo 2 avisos por rodada e 5 por dia (lembretes com horário não contam);
 * - cada tipo tem sua janela: "amanhã você tem…" só a partir das 18h; contas e vencimentos a partir das 8h.
 */
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { unpaidInvoicesDue } from "./cards";
import type { DB } from "@/db";
import { notifications, pushSubscriptions, reminders, userPreferences, users, type User } from "@/db/schema";
import { computeAlerts, type Alert } from "./data/alerts";
import { ensureRecurringBills, expiringItems, occurrences, openReminders, openTasks, pendingBills, shoppingOpen } from "./data/queries";
import { getAccess } from "./access";
import { addDays, nowTimeIn, todayIn } from "./dates";
import { sendPush } from "./push";
import { log } from "./logger";

export type Candidate = { key: string; kind: string; text: string; timed: boolean; url: string; weight: number };

const WINDOW_FROM: Record<string, string> = {
  event_tomorrow: "18:00", event_soon: "08:00", bill_due: "08:00", bill_late: "09:00", task_late: "09:00",
  shopping_stale: "10:00", reminder: "08:00", document_expiring: "09:00", document_expired: "09:00", warranty_expiring: "10:00",
};
const URL_FOR: Record<string, string> = {
  event_tomorrow: "/agenda", event_soon: "/agenda", bill_due: "/financeiro", bill_late: "/financeiro", task_late: "/agenda?tab=tarefas",
  shopping_stale: "/casa", reminder: "/agenda", document_expiring: "/casa?tab=documentos", document_expired: "/casa?tab=documentos", warranty_expiring: "/casa?tab=garantias",
};

export function inQuietHours(now: string, start = "22:00", end = "07:00"): boolean {
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Decide o que enviar agora. Função pura (testável). */
export function planNotifications(input: {
  now: string; quiet: { start: string; end: string }; alerts: Alert[];
  timedReminders: { id: string; text: string; time: string }[];
  eventsToday: { id: string; title: string; time: string | null }[];
  alreadyHandled: Set<string>; sentToday: number;
}): Candidate[] {
  const { now } = input;
  const out: Candidate[] = [];
  // 1) lembretes com horário: na hora (até 10 min de atraso), mesmo no silêncio — o usuário pediu esse horário
  for (const r of input.timedReminders) {
    const d = minutes(now) - minutes(r.time);
    if (d >= 0 && d <= 10) out.push({ key: `remt:${r.id}`, kind: "reminder_now", text: `🔔 ${r.text}`, timed: true, url: "/agenda", weight: 10 });
  }
  const quiet = inQuietHours(now, input.quiet.start, input.quiet.end);
  if (!quiet) {
    // 2) compromisso em até 1 hora
    for (const e of input.eventsToday) {
      if (!e.time) continue;
      const d = minutes(e.time) - minutes(now);
      if (d > 0 && d <= 60) out.push({ key: `soon:${e.id}:${e.time}`, kind: "event_in_1h", text: `⏰ ${e.title} às ${e.time}`, timed: true, url: "/agenda", weight: 9 });
    }
    // 3) alertas do dia, cada um na sua janela
    for (const a of input.alerts) {
      if (a.kind === "reminder") continue; // lembretes são tratados acima / no próprio dia
      if (now < (WINDOW_FROM[a.kind] ?? "09:00")) continue;
      out.push({ key: a.key, kind: a.kind, text: `${a.icon} ${a.text}`, timed: false, url: URL_FOR[a.kind] ?? "/", weight: a.weight });
    }
  }
  const fresh = out.filter((c) => !input.alreadyHandled.has(c.key)).sort((a, b) => b.weight - a.weight);
  const timed = fresh.filter((c) => c.timed);
  const budget = Math.max(0, Math.min(2, 5 - input.sentToday));
  return [...timed, ...fresh.filter((c) => !c.timed).slice(0, budget)];
}

/** Uma rodada para um usuário. */
export async function notifyUser(db: DB, user: User, nowDate = new Date()): Promise<number> {
  const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
  if (prefs && !prefs.notificationsEnabled) return 0;
  const tz = user.timezone;
  const today = todayIn(tz, nowDate), now = nowTimeIn(tz, nowDate);
  const access = await getAccess(db, user);
  await ensureRecurringBills(db, user.id, today, tz);

  const [occ, rems, bills, tks, shop, exp] = await Promise.all([
    occurrences(db, access, today, addDays(today, 7)),
    openReminders(db, user.id, addDays(today, -3), today),
    pendingBills(db, access, addDays(today, 2)),
    openTasks(db, access),
    shoppingOpen(db, access),
    expiringItems(db, user.id, addDays(today, 30)),
  ]);
  const uniqueEvents = [...new Map(occ.map((o) => [o.event.id, o.event])).values()];
  const alerts = computeAlerts({ today, tz, events: uniqueEvents, bills, tasks: tks, shopping: shop, reminders: rems.filter((r) => !r.time), docs: exp.docs, warranties: exp.wars, invoices: await unpaidInvoicesDue(db, user.id, today, addDays(today, 3)) });
  const timedReminders = rems.filter((r) => r.date === today && r.time && !r.sentAt).map((r) => ({ id: r.id, text: r.text, time: r.time! }));
  const eventsToday = occ.filter((o) => o.day === today).map((o) => ({ id: o.event.id, title: o.event.title, time: o.event.time }));

  const keys = [...alerts.map((a) => a.key), ...timedReminders.map((r) => `remt:${r.id}`), ...eventsToday.map((e) => `soon:${e.id}:${e.time}`)];
  const handled = keys.length ? await db.select({ k: notifications.dedupeKey }).from(notifications)
    .where(and(eq(notifications.userId, user.id), inArray(notifications.dedupeKey, keys))) : [];
  const startOfDay = new Date(nowDate.getTime() - 24 * 3600_000);
  const [{ n: sentToday }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, user.id), isNotNull(notifications.sentAt), gte(notifications.sentAt, startOfDay), sql`${notifications.kind} not in ('reminder_now','event_in_1h')`));

  const plan = planNotifications({
    now, quiet: { start: prefs?.quietHoursStart ?? "22:00", end: prefs?.quietHoursEnd ?? "07:00" },
    alerts, timedReminders, eventsToday, alreadyHandled: new Set(handled.map((h) => h.k)), sentToday,
  });

  let sent = 0;
  for (const c of plan) {
    // grava ANTES de enviar: se o cron rodar duas vezes, o índice único impede aviso duplicado
    const inserted = await db.insert(notifications).values({
      userId: user.id, kind: c.kind, title: c.text, dedupeKey: c.key, scheduledFor: nowDate, sentAt: nowDate,
    }).onConflictDoNothing().returning({ id: notifications.id });
    if (!inserted.length) continue;
    const delivered = await sendPush(db, user.id, { title: "Organiza", body: c.text, url: c.url, tag: c.key });
    if (c.key.startsWith("remt:")) await db.update(reminders).set({ sentAt: nowDate }).where(eq(reminders.id, c.key.slice(5)));
    if (delivered) sent++;
  }
  return sent;
}

/** Rodada para todos os usuários com algum aparelho inscrito. */
export async function runNotifications(db: DB, nowDate = new Date()) {
  const rows = await db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions);
  let users_ = 0, sent = 0;
  for (const { userId } of rows) {
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) continue;
    try { sent += await notifyUser(db, u, nowDate); users_++; }
    catch (e) { log.error("notify.user_failed", { userId, error: e as Error }); }
  }
  log.info("notify.run", { users: users_, sent });
  return { users: users_, sent };
}
