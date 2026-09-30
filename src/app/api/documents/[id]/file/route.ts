import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { documents } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { AppError, route } from "@/lib/errors";
import { getFile } from "@/lib/storage";

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"]);

/** Baixa o arquivo do documento — só o dono. Nunca é servido como HTML/script. */
export const GET = route("documents.download", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const [doc] = await getDb().select().from(documents).where(and(eq(documents.id, id), eq(documents.userId, user.id))).limit(1);
  if (!doc?.fileKey || !doc.mimeType || !ALLOWED.has(doc.mimeType)) throw new AppError(404, "Arquivo não encontrado.", "not_found");
  const data = await getFile(doc.fileKey);
  const inline = new URL(req.url).searchParams.get("view") === "1";
  const name = encodeURIComponent(doc.fileName || `${doc.name}.${doc.mimeType.split("/")[1]}`);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
