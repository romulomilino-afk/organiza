import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { AppError, route } from "@/lib/errors";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runTick } from "@/lib/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Chamado a cada 5 minutos por um agendador (Vercel Cron, crontab, GitHub Actions…):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://seu-dominio/api/cron/tick
 * Em desenvolvimento, use `npm run worker`.
 */
async function handler(req: Request) {
  if (!isCronAuthorized(req)) throw new AppError(401, "Não autorizado.", "unauthorized");
  return NextResponse.json(await runTick(getDb()));
}

export const GET = route("cron.tick", handler);
export const POST = route("cron.tick", handler);
