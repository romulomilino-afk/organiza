import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { documents, warranties } from "@/db/schema";
import { requireAccess } from "@/lib/session";
import { AppError, route, tooMany } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { hasFeature } from "@/lib/plans";
import { isISODate, todayIn, addMonths, cap } from "@/lib/dates";
import { MAX_FILE_BYTES, USER_QUOTA_BYTES, putFile, sniffMime } from "@/lib/storage";
import { log } from "@/lib/logger";

const meta = z.object({
  name: z.string().trim().min(1, "Dê um nome ao documento").max(120),
  category: z.enum(["NOTA_FISCAL", "DOCUMENTO", "CONTRATO", "GARANTIA", "MANUAL", "OUTRO"]).default("OUTRO"),
  expiresAt: z.string().optional().transform((v) => (v && isISODate(v) ? v : undefined)),
  notes: z.string().max(500).optional(),
  warrantyMonths: z.coerce.number().int().min(1).max(240).optional().catch(undefined),
});

/** POST multipart: guarda um documento (arquivo opcional, criptografado). */
export const POST = route("documents.upload", async (req: Request) => {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "documentos")) throw new AppError(402, "Guardar documentos faz parte do plano Premium.", "plan_required");
  if (!rateLimit(`upload:${user.id}`, 20, 60 * 60_000)) throw tooMany("Muitos envios em pouco tempo. Tente mais tarde.");

  const form = await req.formData();
  const m = meta.parse({
    name: form.get("name"), category: form.get("category") || undefined, expiresAt: form.get("expiresAt") || undefined,
    notes: form.get("notes") || undefined, warrantyMonths: form.get("warrantyMonths") || undefined,
  });
  const db = getDb();
  const file = form.get("file");
  let fileKey: string | null = null, mimeType: string | null = null, sizeBytes: number | null = null, fileName: string | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) throw new AppError(413, "Arquivo maior que 4 MB. Envie uma versão menor.", "too_large");
    const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${documents.sizeBytes}),0)::int` }).from(documents).where(eq(documents.userId, user.id));
    if (used + file.size > USER_QUOTA_BYTES) throw new AppError(413, "Seu espaço de 500 MB está cheio. Apague documentos antigos.", "quota");
    const buf = Buffer.from(await file.arrayBuffer());
    mimeType = sniffMime(buf);
    if (!mimeType) throw new AppError(415, "Envie PDF ou foto (JPG, PNG, WEBP, HEIC).", "unsupported");
    try {
      fileKey = await putFile(user.id, buf);
    } catch (e) {
      const err = e as Error & { cause?: Error; code?: string };
      const detail = `${err.code ? err.code + " " : ""}${err.name}: ${err.cause?.message ?? err.message}`
        .replace(/postgres(ql)?:\/\/\S+/gi, "[banco]").replace(/\s+/g, " ").slice(0, 160);
      log.error("documents.storage_failed", { userId: user.id, detail });
      throw new AppError(503, `Não consegui guardar o arquivo agora. (detalhe: ${detail})`, "storage");
    }
    sizeBytes = file.size;
    fileName = file.name.replace(/[^\w.\- À-ú]/g, "_").slice(0, 120);
  }

  const today = todayIn(user.timezone);
  const [doc] = await db.insert(documents).values({
    userId: user.id, name: cap(m.name), category: m.category, date: today, expiresAt: m.expiresAt ?? null, notes: m.notes ?? null,
    fileKey, fileName, mimeType, sizeBytes,
  }).returning({ id: documents.id });

  // garantia em meses → cria a garantia ligada ao documento
  if (m.category === "GARANTIA" || m.warrantyMonths) {
    const months = m.warrantyMonths ?? 12;
    await db.insert(warranties).values({ userId: user.id, item: cap(m.name), purchaseDate: today, months, expiresAt: addMonths(today, months), documentId: doc.id });
  }
  log.info("documents.saved", { userId: user.id, hasFile: !!fileKey, bytes: sizeBytes ?? 0 });
  return NextResponse.json({ ok: true, id: doc.id }, { status: 201 });
});
