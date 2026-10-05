/**
 * Testes da fase 2 contra Postgres real em memória (PGlite):
 * família, pagamentos (Asaas), avisos, arquivos e WhatsApp.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { getAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { handleMessage } from "../src/lib/nina";
import { executeActions } from "../src/lib/nina/executor";
import { occurrences, openTasks, shoppingOpen } from "../src/lib/data/queries";
import { acceptInvite, createHousehold, createInvite, leaveHousehold } from "../src/lib/family";
import { cleanCpfCnpj, handleAsaasEvent, runBillingMaintenance } from "../src/lib/billing";
import { inQuietHours, notifyUser, planNotifications } from "../src/lib/notify";
import { decrypt, encrypt, getFile, putFile, sniffMime } from "../src/lib/storage";
import { createLinkCode, handleInbound, verifySignature, type WhatsAppClient } from "../src/lib/whatsapp";
import { addDays, todayIn } from "../src/lib/dates";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.VAPID_PUBLIC_KEY;
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "organiza-"));
process.env.AUTH_SECRET = "test-secret";

let db: DB;
const mk = async (email: string, plan: "FREE" | "PREMIUM" | "FAMILY", name = email.split("@")[0]) => {
  const [u] = await db.insert(schema.users).values({ email, name, plan, onboarded: true }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const reload = async (u: schema.User) => (await db.select().from(schema.users).where(eq(schema.users.id, u.id)))[0];
const today = () => todayIn("America/Sao_Paulo");

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

// ─────────────── Família ───────────────
test("família: convite, lista de compras compartilhada e isolamento", async () => {
  const mae = await mk("mae@f.com", "FAMILY", "Ana");
  const pai = await mk("pai@f.com", "FREE", "Beto");
  const vizinho = await mk("viz@f.com", "PREMIUM");

  await createHousehold(db, mae, "Família Souza");
  const token = await createInvite(db, mae);
  await acceptInvite(db, pai, token);
  await assert.rejects(acceptInvite(db, vizinho, token), /expirou ou já foi usado/); // uso único

  const aPai = await getAccess(db, pai);
  assert.equal(aPai.plan, "FAMILY"); // herda o plano do dono
  assert.ok(aPai.household?.active);

  // pai coloca na lista → mãe vê; vizinho não
  await handleMessage(db, pai, "Estou sem leite e pão");
  const aMae = await getAccess(db, mae);
  assert.deepEqual((await shoppingOpen(db, aMae)).map((i) => i.name).sort(), ["Leite", "Pão"]);
  assert.equal((await shoppingOpen(db, await getAccess(db, vizinho))).length, 0);

  // mãe marca o leite (que o pai colocou) como comprado
  const leite = (await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.name, "Leite")))[0];
  const r = await executeActions(db, aMae, today(), [{ type: "check_shopping", items: ["Leite"] }]);
  assert.equal(r.executed.length, 1);
  assert.equal((await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.id, leite.id)))[0].checked, true);

  // compromisso "da família" é compartilhado; pessoal não
  await handleMessage(db, pai, "A gente tem reunião na escola amanhã às 19h");
  await handleMessage(db, pai, "Tenho dentista amanhã às 10h");
  const occMae = await occurrences(db, aMae, addDays(today(), 1), addDays(today(), 1));
  assert.deepEqual(occMae.map((o) => o.event.time), ["19:00"]);

  // mãe não consegue concluir tarefa pessoal do pai
  await handleMessage(db, pai, "Preciso renovar minha CNH");
  const [cnh] = await openTasks(db, aPai);
  const x = await executeActions(db, aMae, today(), [{ type: "complete_task", id: cnh.id }]);
  assert.equal(x.skipped, 1);

  // vizinho não vê o compromisso da família
  assert.equal((await occurrences(db, await getAccess(db, vizinho), addDays(today(), 1), addDays(today(), 1))).length, 0);

  // dono sem plano Família → nada mais é compartilhado
  await db.update(schema.users).set({ plan: "PREMIUM" }).where(eq(schema.users.id, mae.id));
  const aPai2 = await getAccess(db, pai);
  assert.equal(aPai2.plan, "FREE");
  assert.equal(aPai2.household?.active, false);
  assert.equal((await shoppingOpen(db, aPai2)).filter((i) => i.userId !== pai.id).length, 0);
  await db.update(schema.users).set({ plan: "FAMILY" }).where(eq(schema.users.id, mae.id));

  // família cheia (5)
  const extras = await Promise.all([1, 2, 3].map((i) => mk(`k${i}@f.com`, "FREE")));
  for (const k of extras) await acceptInvite(db, k, await createInvite(db, await reload(mae)));
  await assert.rejects(createInvite(db, await reload(mae)), /já tem 5 pessoas/);

  // dono apaga a família → itens voltam a ser pessoais de quem criou
  await leaveHousehold(db, await reload(mae));
  const pao = (await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.name, "Pão")))[0];
  assert.equal(pao.householdId, null);
  assert.equal(pao.userId, pai.id);
});

test("família: só plano Família cria família", async () => {
  const u = await mk("free-fam@f.com", "FREE");
  await assert.rejects(createHousehold(db, u, "X"), /plano Família/);
});

// ─────────────── Pagamentos ───────────────
test("CPF/CNPJ: validação dos dígitos", () => {
  assert.equal(cleanCpfCnpj("529.982.247-25"), "52998224725");
  assert.equal(cleanCpfCnpj("111.111.111-11"), null);
  assert.equal(cleanCpfCnpj("529.982.247-24"), null);
  assert.equal(cleanCpfCnpj("11.222.333/0001-81"), "11222333000181");
  assert.equal(cleanCpfCnpj("11.222.333/0001-80"), null);
});

test("Asaas: pagamento ativa o plano, evento repetido é ignorado, atraso rebaixa após 7 dias", async () => {
  const u = await mk("pagante@f.com", "FREE");
  await db.insert(schema.billingSubscriptions).values({ userId: u.id, providerSubscriptionId: "sub_123", plan: "PREMIUM", valueCents: 1490 });
  const ev = { id: "evt_1", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", subscription: "sub_123", dueDate: "2026-09-29", invoiceUrl: "https://x/i" } };
  assert.equal(await handleAsaasEvent(db, ev), "processed");
  assert.equal((await reload(u)).plan, "PREMIUM");
  assert.equal(await handleAsaasEvent(db, ev), "duplicate");
  const [b] = await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, u.id));
  assert.equal(b.status, "ACTIVE");
  assert.equal(b.currentPeriodEnd, "2026-10-29");

  await handleAsaasEvent(db, { id: "evt_2", event: "PAYMENT_OVERDUE", payment: { id: "pay_2", subscription: "sub_123" } });
  await runBillingMaintenance(db, new Date()); // ainda na carência
  assert.equal((await reload(u)).plan, "PREMIUM");
  await runBillingMaintenance(db, new Date(Date.now() + 8 * 86_400_000));
  assert.equal((await reload(u)).plan, "FREE");

  // pagou depois → volta
  await handleAsaasEvent(db, { id: "evt_3", event: "PAYMENT_RECEIVED", payment: { id: "pay_2", subscription: "sub_123", dueDate: "2026-10-29" } });
  assert.equal((await reload(u)).plan, "PREMIUM");
  // evento de assinatura desconhecida não quebra
  assert.equal(await handleAsaasEvent(db, { id: "evt_4", event: "PAYMENT_CONFIRMED", payment: { id: "p", subscription: "sub_x" } }), "ignored");
});

// ─────────────── Avisos ───────────────
test("avisos: silêncio, janelas e limite", () => {
  assert.equal(inQuietHours("23:30"), true);
  assert.equal(inQuietHours("06:59"), true);
  assert.equal(inQuietHours("07:00"), false);
  const alerts = [
    { key: "ev:1", kind: "event_tomorrow", icon: "🔔", text: "Amanhã: dentista", level: "info" as const, weight: 3 },
    { key: "bill:1", kind: "bill_due", icon: "⚠️", text: "Luz vence amanhã", level: "warn" as const, weight: 4 },
    { key: "late:1", kind: "task_late", icon: "🔴", text: "2 atrasadas", level: "bad" as const, weight: 5 },
    { key: "shop:1", kind: "shopping_stale", icon: "🛒", text: "Leite há 5 dias", level: "warn" as const, weight: 2 },
  ];
  const base = { quiet: { start: "22:00", end: "07:00" }, alerts, timedReminders: [], eventsToday: [], alreadyHandled: new Set<string>(), sentToday: 0 };
  // de manhã: "amanhã você tem…" ainda não; máximo 2 por rodada
  const morning = planNotifications({ ...base, now: "10:30" });
  assert.deepEqual(morning.map((c) => c.key), ["late:1", "bill:1"]);
  // à noite: aparece o de amanhã
  assert.ok(planNotifications({ ...base, now: "19:00", alreadyHandled: new Set(["late:1", "bill:1"]) }).some((c) => c.key === "ev:1"));
  // no silêncio: nada, exceto lembrete com horário
  const night = planNotifications({ ...base, now: "23:00", timedReminders: [{ id: "r1", text: "Tomar remédio", time: "23:00" }] });
  assert.deepEqual(night.map((c) => c.key), ["remt:r1"]);
  // limite diário de 5
  assert.equal(planNotifications({ ...base, now: "10:30", sentToday: 5 }).length, 0);
});

test("avisos: rodada grava cada aviso uma vez só", async () => {
  const u = await mk("avisos@f.com", "PREMIUM");
  await handleMessage(db, u, "Me lembra de ligar para o banco hoje às 10h");
  const at10 = new Date(`${today()}T13:02:00Z`); // 10:02 em São Paulo
  await notifyUser(db, u, at10);
  await notifyUser(db, u, at10); // cron rodou duas vezes
  const rows = await db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, u.id), eq(schema.notifications.kind, "reminder_now")));
  assert.equal(rows.length, 1);
  assert.match(rows[0].title, /Ligar para o banco/);
});

// ─────────────── Arquivos ───────────────
test("arquivos: tipo pelo conteúdo e criptografia em repouso", async () => {
  const pdf = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj");
  assert.equal(sniffMime(pdf), "application/pdf");
  assert.equal(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "image/png");
  assert.equal(sniffMime(Buffer.from("<html><script>alert(1)</script>")), null);
  const enc = encrypt(pdf);
  assert.ok(!enc.includes(Buffer.from("%PDF")));
  assert.deepEqual(decrypt(enc), pdf);
  const key = await putFile("user-1", pdf);
  assert.deepEqual(await getFile(key), pdf);
  const tampered = Buffer.from(enc); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered)); // GCM detecta alteração
});

// ─────────────── WhatsApp ───────────────
test("WhatsApp: assinatura do webhook", () => {
  const body = JSON.stringify({ hello: "mundo çã" });
  const sig = "sha256=" + createHmac("sha256", "segredo").update(body).digest("hex");
  assert.equal(verifySignature(body, sig, "segredo"), true);
  assert.equal(verifySignature(body + " ", sig, "segredo"), false);
  assert.equal(verifySignature(body, null, "segredo"), false);
});

test("WhatsApp: vincular número, conversar, botão de sugestão e idempotência", async () => {
  const sent: { to: string; body: string; buttons?: string[] }[] = [];
  const wa: WhatsAppClient = {
    async sendText(to, body) { sent.push({ to, body }); },
    async sendButtons(to, body, buttons) { sent.push({ to, body, buttons: buttons.map((b) => b.id) }); },
    async downloadMedia() { return null; },
  };
  const u = await mk("zap@f.com", "PREMIUM", "Rômulo");
  const payload = (id: string, from: string, text: string, button?: string) => ({
    entry: [{ changes: [{ field: "messages", value: { messages: [
      button ? { id, from, type: "interactive", interactive: { type: "button_reply", button_reply: { id: button, title: "Sim" } } }
        : { id, from, type: "text", text: { body: text } },
    ] } }] }],
  });

  // número desconhecido → instruções
  await handleInbound(db, payload("w1", "5521999990000", "oi"), wa);
  assert.match(sent.at(-1)!.body, /gere seu código/);

  // manda o código → vinculado
  const code = await createLinkCode(db, u.id);
  await handleInbound(db, payload("w2", "5521999990000", `Meu código: ${code}`), wa);
  assert.match(sent.at(-1)!.body, /Pronto, Rômulo!/);
  assert.equal((await reload(u)).phone, "5521999990000");

  // conversa normal
  await handleInbound(db, payload("w3", "5521999990000", "Tenho dentista dia 20 às 14h"), wa);
  const withButtons = sent.at(-1)!;
  assert.ok(withButtons.buttons?.[0].startsWith("sg:"));
  assert.match(sent.at(-2)!.body, /Dentista/);

  // toca no "Sim, lembrar"
  await handleInbound(db, payload("w4", "5521999990000", "", withButtons.buttons![0]), wa);
  assert.match(sent.at(-1)!.body, /Vou te lembrar/);
  const [ev] = await db.select().from(schema.events).where(eq(schema.events.userId, u.id));
  assert.equal(ev.remindDaysBefore, 1);

  // a Meta reenviou a mesma mensagem → ignorada
  const before = sent.length;
  await handleInbound(db, payload("w3", "5521999990000", "Tenho dentista dia 20 às 14h"), wa);
  assert.equal(sent.length, before);
  assert.equal((await db.select().from(schema.events).where(eq(schema.events.userId, u.id))).length, 1);

  // plano grátis não usa o WhatsApp
  const f = await mk("zapfree@f.com", "FREE");
  const c2 = await createLinkCode(db, f.id);
  await handleInbound(db, payload("w5", "5511988887777", c2), wa);
  await handleInbound(db, payload("w6", "5511988887777", "Gastei 10 reais"), wa);
  assert.match(sent.at(-1)!.body, /plano Premium/);
});

test("arquivos no banco (padrão no Netlify): guarda criptografado, lê de volta e apaga", async () => {
  const { setStorageDb, deleteFile } = await import("../src/lib/storage");
  const u = await mk("arquivo-db@x.com", "PREMIUM");
  const prev = process.env.STORAGE_DRIVER;
  process.env.STORAGE_DRIVER = "db";
  setStorageDb(db);
  try {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(3 * 1024 * 1024, 7)]); // 3 MB
    const key = await putFile(u.id, pdf);
    const [row] = await db.select().from(schema.documentFiles).where(eq(schema.documentFiles.key, key));
    assert.ok(row && !row.data.includes(Buffer.from("%PDF")), "no banco fica só o conteúdo criptografado");
    assert.deepEqual(await getFile(key), pdf);
    await deleteFile(key);
    assert.equal((await db.select().from(schema.documentFiles).where(eq(schema.documentFiles.key, key))).length, 0);
  } finally {
    setStorageDb(null);
    if (prev === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = prev;
  }
});

test("arquivos no banco: se a tabela não existir (migração não rodou), cria sozinho e guarda", async () => {
  const { setStorageDb } = await import("../src/lib/storage");
  const { sql } = await import("drizzle-orm");
  const u = await mk("autocura@x.com", "PREMIUM");
  const prev = process.env.STORAGE_DRIVER;
  process.env.STORAGE_DRIVER = "db";
  setStorageDb(db);
  try {
    await db.execute(sql`DROP TABLE "document_files"`);
    const pdf = Buffer.from("%PDF-1.4 teste");
    const key = await putFile(u.id, pdf);
    assert.deepEqual(await getFile(key), pdf);
  } finally {
    setStorageDb(null);
    if (prev === undefined) delete process.env.STORAGE_DRIVER; else process.env.STORAGE_DRIVER = prev;
  }
});
