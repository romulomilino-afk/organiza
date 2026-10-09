#!/usr/bin/env node
/**
 * Teste de carga do Meu Organiza.
 *
 * Simula várias pessoas usando o sistema AO MESMO TEMPO e mostra quanto tempo cada tela leva
 * para responder e se houve erros. Use uma CONTA DE TESTE (não a sua conta real).
 *
 * Como rodar (no computador, com o Node.js instalado):
 *   node scripts/teste-carga.mjs --email teste@exemplo.com --senha suaSenha123
 *
 * Opções:
 *   --url        endereço do site               (padrão: https://meuorganiza.com.br)
 *   --usuarios   pessoas ao mesmo tempo          (padrão: 50)
 *   --segundos   duração do teste                (padrão: 60)
 *   --chat       mensagens para a Nina no total  (padrão: 10; cada uma custa uma fração de centavo na IA)
 *   --email / --senha   conta de teste (sem elas, testa só as páginas públicas)
 *
 * Exemplo maior:  node scripts/teste-carga.mjs --usuarios 200 --segundos 120 --chat 30 --email ... --senha ...
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? "1" : all[i + 1] ?? "1"]] : acc), []),
);
const BASE = (args.url || "https://meuorganiza.com.br").replace(/\/$/, "");
const VUS = Math.max(1, Math.min(1000, Number(args.usuarios) || 50));
const SECONDS = Math.max(5, Math.min(600, Number(args.segundos) || 60));
const CHAT_TOTAL = Math.max(0, Math.min(200, args.chat === undefined ? 10 : Number(args.chat) || 0));
const EMAIL = args.email, PASSWORD = args.senha;

const PUBLIC_ROUTES = ["/", "/login", "/manifest.webmanifest"];
const APP_ROUTES = ["/", "/financeiro", "/agenda", "/casa", "/pendencias"];
const CHAT_TEXTS = ["Oi Nina, tudo bem?", "Quais são minhas pendências de hoje?", "Como está meu mês?"];

const stats = new Map(); // rota -> { ok, fail, ms[], codes{} }
function record(name, ms, status) {
  const s = stats.get(name) ?? { ok: 0, fail: 0, ms: [], codes: {} };
  if (status >= 200 && status < 400) s.ok++; else s.fail++;
  s.ms.push(ms);
  s.codes[status] = (s.codes[status] ?? 0) + 1;
  stats.set(name, s);
}
const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]; };

async function hit(name, path, init = {}) {
  const t = performance.now();
  let status = 0;
  try {
    const res = await fetch(BASE + path, { redirect: "manual", ...init, signal: AbortSignal.timeout(30_000) });
    status = res.status;
    await res.arrayBuffer();
  } catch {
    status = 0; // sem resposta (tempo esgotado ou conexão recusada)
  }
  record(name, performance.now() - t, status);
  return status;
}

function cookiesFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  return list.filter(Boolean).map((c) => c.split(";")[0]);
}
/** Junta cookies; se o mesmo nome vier duas vezes, vale o último. */
function mergeCookies(...lists) {
  const m = new Map();
  for (const c of lists.flat()) m.set(c.split("=")[0], c);
  return [...m.values()];
}

async function login() {
  const r1 = await fetch(BASE + "/api/auth/csrf");
  const { csrfToken } = await r1.json();
  const jar = mergeCookies(cookiesFrom(r1));
  const body = new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE + "/" });
  const r2 = await fetch(BASE + "/api/auth/callback/credentials", {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.join("; ") },
    body,
  });
  const all = mergeCookies(jar, cookiesFrom(r2));
  const session = all.find((c) => /authjs\.session-token=/.test(c));
  if (!session) throw new Error("Não consegui entrar com essa conta. Confira o e-mail e a senha da conta de teste.");
  return all.join("; ");
}

async function main() {
  console.log(`\nTeste de carga · ${BASE}`);
  console.log(`${VUS} pessoas ao mesmo tempo · ${SECONDS}s · ${EMAIL ? `conta ${EMAIL}` : "só páginas públicas"} · ${EMAIL ? CHAT_TOTAL : 0} mensagens para a Nina\n`);

  let cookie = null;
  if (EMAIL && PASSWORD) { cookie = await login(); console.log("✓ Entrou na conta de teste\n"); }

  const end = Date.now() + SECONDS * 1000;
  let chatLeft = cookie ? CHAT_TOTAL : 0;
  const chatEvery = chatLeft ? (SECONDS * 1000) / chatLeft : Infinity;
  let nextChat = Date.now() + 2000;

  const ticker = setInterval(() => {
    const total = [...stats.values()].reduce((a, s) => a + s.ok + s.fail, 0);
    const fails = [...stats.values()].reduce((a, s) => a + s.fail, 0);
    process.stdout.write(`\r  ${Math.max(0, Math.ceil((end - Date.now()) / 1000))}s restantes · ${total} pedidos · ${fails} com erro   `);
  }, 1000);

  async function virtualUser(i) {
    await new Promise((r) => setTimeout(r, Math.random() * 2000)); // chegam aos poucos
    while (Date.now() < end) {
      const logged = cookie && i % 4 !== 0; // 3 de cada 4 usam o app logado; 1 é visitante
      if (logged) {
        const p = APP_ROUTES[Math.floor(Math.random() * APP_ROUTES.length)];
        await hit(`app ${p}`, p, { headers: { Cookie: cookie } });
        if (chatLeft > 0 && Date.now() >= nextChat) {
          chatLeft--; nextChat = Date.now() + chatEvery;
          await hit("Nina (IA)", "/api/chat", {
            method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ text: CHAT_TEXTS[chatLeft % CHAT_TEXTS.length] }),
          });
        }
      } else {
        const p = PUBLIC_ROUTES[Math.floor(Math.random() * PUBLIC_ROUTES.length)];
        await hit(`visitante ${p}`, p);
      }
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000)); // pessoa "lendo" a tela
    }
  }

  await Promise.all(Array.from({ length: VUS }, (_, i) => virtualUser(i)));
  clearInterval(ticker);

  console.log("\n\nResultado:\n");
  const rows = [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, s]) => ({
    tela: name,
    pedidos: s.ok + s.fail,
    "ok %": (((s.ok) / (s.ok + s.fail)) * 100).toFixed(1),
    "típico (ms)": Math.round(pct(s.ms, 50)),
    "lento 95% (ms)": Math.round(pct(s.ms, 95)),
    "pior (ms)": Math.round(Math.max(...s.ms)),
    erros: Object.entries(s.codes).filter(([c]) => !(+c >= 200 && +c < 400)).map(([c, n]) => `${c === "0" ? "sem resposta" : c}×${n}`).join(" ") || "-",
  }));
  console.table(rows);

  const all = [...stats.values()];
  const total = all.reduce((a, s) => a + s.ok + s.fail, 0);
  const ok = all.reduce((a, s) => a + s.ok, 0);
  const p95 = pct(all.flatMap((s) => s.ms), 95);
  console.log(`\nTotal: ${total} pedidos · ${((ok / total) * 100).toFixed(1)}% sem erro · 95% responderam em até ${Math.round(p95)} ms`);
  console.log(ok / total >= 0.99 && p95 < 3000
    ? "✅ Aguentou bem essa quantidade de pessoas."
    : ok / total >= 0.95 ? "⚠️ Aguentou, mas com lentidão ou alguns erros. Veja a tabela." : "❌ Muitos erros com essa quantidade de pessoas. Veja a tabela.");
  console.log("Legenda: 429 = limite de segurança por pessoa (normal no chat com uma só conta) · 5xx = erro no servidor · sem resposta = demorou mais de 30 s\n");
}

main().catch((e) => { console.error("\n" + (e?.message || e)); process.exit(1); });
