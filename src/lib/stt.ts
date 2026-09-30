/** Áudio → texto (OpenAI). Compartilhado entre o app e o WhatsApp. */
import { log } from "./logger";

export function sttEnabled() {
  return !!process.env.OPENAI_API_KEY;
}

export async function transcribe(audio: Blob, filename = "audio.ogg"): Promise<string | null> {
  if (!sttEnabled()) return null;
  const out = new FormData();
  out.append("file", audio, filename);
  out.append("model", process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  out.append("language", "pt");
  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: out,
  });
  if (!res.ok) {
    log.error("stt.failed", { status: res.status });
    return null;
  }
  const data = (await res.json()) as { text?: string };
  log.info("stt.ok", { ms: Date.now() - started, bytes: audio.size });
  return (data.text ?? "").trim() || null;
}
