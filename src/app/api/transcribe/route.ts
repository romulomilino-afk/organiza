import { NextResponse } from "next/server";
import { requireAccess, requireUser } from "@/lib/session";
import { AppError, route, tooMany } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { hasFeature } from "@/lib/plans";
import { log } from "@/lib/logger";
import { transcribe } from "@/lib/stt";

const MAX_BYTES = 8 * 1024 * 1024; // ~ 1 minuto de áudio comprimido
const TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-m4a", "audio/aac"];

/** GET: diz ao app se a transcrição no servidor está disponível. */
export const GET = route("transcribe.status", async () => {
  await requireUser();
  return NextResponse.json({ enabled: !!process.env.OPENAI_API_KEY });
});

/**
 * POST (multipart, campo "audio"): transcreve com a API da OpenAI.
 * Usado quando o navegador não tem reconhecimento de voz nativo.
 */
export const POST = route("transcribe", async (req: Request) => {
  const { user, access } = await requireAccess();
  if (!hasFeature(access.plan, "audio")) throw new AppError(402, "Falar com a Nina por áudio faz parte do plano Premium.", "plan_required");
  if (!process.env.OPENAI_API_KEY) throw new AppError(501, "Transcrição no servidor não configurada.", "not_configured");
  if (!rateLimit(`stt:${user.id}`, 10, 60_000)) throw tooMany();

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof Blob)) throw new AppError(400, "Envie o áudio no campo 'audio'.", "invalid_input");
  if (file.size === 0 || file.size > MAX_BYTES) throw new AppError(413, "Áudio vazio ou muito longo.", "too_large");
  const type = file.type.split(";")[0];
  if (!TYPES.includes(type)) throw new AppError(415, "Formato de áudio não suportado.", "unsupported");

  const text = await transcribe(file, `audio.${type.split("/")[1] ?? "webm"}`);
  if (text === null) throw new AppError(502, "Não consegui entender o áudio. Tente de novo ou digite.", "stt_failed");
  log.info("stt.request", { userId: user.id });
  return NextResponse.json({ text });
});
