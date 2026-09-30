/** Tudo que roda periodicamente, num lugar só (cron ou worker local). */
import type { DB } from "@/db";
import { runNotifications } from "./notify";
import { runBillingMaintenance } from "./billing";
import { log } from "./logger";

export async function runTick(db: DB, now = new Date()) {
  const started = Date.now();
  const billing = await runBillingMaintenance(db, now).catch((e) => { log.error("tick.billing_failed", { error: e as Error }); return null; });
  const notify = await runNotifications(db, now).catch((e) => { log.error("tick.notify_failed", { error: e as Error }); return null; });
  return { ok: true, ms: Date.now() - started, billing, notify };
}
