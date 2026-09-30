/**
 * Log estruturado (JSON por linha) — pronto para qualquer coletor (Datadog, Loki, CloudWatch).
 * Nunca registre conteúdo de mensagens, senhas ou tokens: só ids, tipos e métricas.
 */
type Level = "debug" | "info" | "warn" | "error";
const SENSITIVE = /pass|senha|token|secret|authorization|cookie|content|message|text/i;

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.test(k)) out[k] = "[omitido]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message };
    else out[k] = v;
  }
  return out;
}

function write(level: Level, event: string, data: Record<string, unknown> = {}) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(data) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (e: string, d?: Record<string, unknown>) => write("debug", e, d),
  info: (e: string, d?: Record<string, unknown>) => write("info", e, d),
  warn: (e: string, d?: Record<string, unknown>) => write("warn", e, d),
  error: (e: string, d?: Record<string, unknown>) => write("error", e, d),
};
