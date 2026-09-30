import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { AppError, route, tooMany } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { pushEnabled } from "@/lib/push";

const sub = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "endpoint inválido"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** GET: chave pública VAPID para o navegador se inscrever. */
export const GET = route("push.key", async () => {
  await requireUser();
  return NextResponse.json({ enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
});

/** POST: registra este aparelho para receber avisos. */
export const POST = route("push.subscribe", async (req: Request) => {
  const user = await requireUser();
  if (!pushEnabled()) throw new AppError(501, "Notificações ainda não configuradas no servidor.", "not_configured");
  if (!rateLimit(`push:${user.id}`, 10, 60_000)) throw tooMany();
  const { endpoint, keys } = sub.parse(await req.json());
  const db = getDb();
  // um endpoint pertence a um aparelho; se trocar de conta no mesmo aparelho, passa para o novo usuário
  await db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.headers.get("user-agent")?.slice(0, 200) })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth } });
  return NextResponse.json({ ok: true });
});

/** DELETE: para de receber avisos neste aparelho. */
export const DELETE = route("push.unsubscribe", async (req: Request) => {
  const user = await requireUser();
  const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await req.json());
  await getDb().delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)));
  return NextResponse.json({ ok: true });
});
