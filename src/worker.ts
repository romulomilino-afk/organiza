/**
 * Worker para desenvolvimento local: roda o "tick" (avisos + manutenção de assinaturas) a cada 5 minutos.
 * Uso: npm run worker
 * Em produção, prefira o endpoint /api/cron/tick chamado por um agendador.
 */
import "dotenv/config";
import { getDb } from "./db";
import { runTick } from "./lib/tick";

const EVERY = 5 * 60_000;

async function loop() {
  try {
    const r = await runTick(getDb());
    console.log(`[worker] ${new Date().toLocaleTimeString("pt-BR")} →`, JSON.stringify(r));
  } catch (e) {
    console.error("[worker] falhou", e);
  }
  setTimeout(loop, EVERY);
}
console.log("[worker] iniciado — rodando a cada 5 minutos");
loop();
