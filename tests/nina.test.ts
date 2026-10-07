/**
 * Testes de ponta a ponta da Nina contra um Postgres real em memória (PGlite).
 * Rodam sem chave de IA: exercitam o interpretador por regras + camada de intenções + executor.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { handleMessage, answerSuggestion } from "../src/lib/nina";
import { executeActions } from "../src/lib/nina/executor";
import { parseNinaOutput } from "../src/lib/nina/actions";
import { fallbackNina } from "../src/lib/nina/fallback";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { monthFinance, occurrences, pendingBills, shoppingOpen, openTasks } from "../src/lib/data/queries";
import { todayIn, addDays } from "../src/lib/dates";
import { soloAccess } from "../src/lib/access";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
let alice: schema.User, bob: schema.User, free: schema.User;

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  [alice] = await db.insert(schema.users).values({ email: "alice@test.com", name: "Alice", plan: "PREMIUM", onboarded: true, trialEndsAt: null }).returning();
  [bob] = await db.insert(schema.users).values({ email: "bob@test.com", name: "Bob", plan: "PREMIUM", onboarded: true, trialEndsAt: null }).returning();
  [free] = await db.insert(schema.users).values({ email: "free@test.com", name: "Free", plan: "FREE", onboarded: true, trialEndsAt: null }).returning();
  for (const u of [alice, bob, free]) await ensureUserSetup(db, u.id);
});

const today = () => todayIn("America/Sao_Paulo");

test("despesa por texto: 'Gastei 45 reais no almoço'", async () => {
  const r = await handleMessage(db, alice, "Gastei 45 reais no almoço");
  assert.match(r.assistant.content, /R\$\s?45,00/);
  const fin = await monthFinance(db, alice.id, today());
  assert.equal(fin.todayCents, 4500);
  assert.equal(fin.byCategory.alimentacao, 4500);
});

test("compra no cartão: 'Comprei um tênis hoje por R$ 350 no cartão'", async () => {
  const r = await handleMessage(db, alice, "Comprei um tênis hoje por R$ 350 no cartão");
  assert.equal(r.assistant.cards.length, 1);
  assert.match(r.assistant.cards[0].lines[0], /Compras · Cartão · Despesa/);
});

test("lista de compras: 'Estou sem arroz, leite, café e papel higiênico'", async () => {
  await handleMessage(db, alice, "Estou sem arroz, leite, café e papel higiênico");
  const items = (await shoppingOpen(db, soloAccess(alice))).map((i) => i.name);
  assert.deepEqual(items, ["Arroz", "Leite", "Café", "Papel higiênico"]);
});

test("pergunta quando falta horário e completa depois", async () => {
  const r1 = await handleMessage(db, alice, "Tenho médico amanhã");
  assert.match(r1.assistant.content, /Qual horário/);
  assert.equal(r1.assistant.cards.length, 0);
  const r2 = await handleMessage(db, alice, "15h");
  assert.equal(r2.assistant.cards[0].icon, "📅");
  const occ = await occurrences(db, soloAccess(alice), addDays(today(), 1), addDays(today(), 1));
  assert.equal(occ.length, 1);
  assert.equal(occ[0].event.time, "15:00");
  // sugestão de lembrete 1 dia antes, executada no servidor
  assert.ok(r2.assistant.suggestion);
  await answerSuggestion(db, alice, r2.assistant.id, true);
  const [ev] = await db.select().from(schema.events).where(eq(schema.events.id, occ[0].event.id));
  assert.equal(ev.remindDaysBefore, 1);
});

test("conta recorrente: 'Minha conta de luz vence todo dia 10'", async () => {
  await handleMessage(db, alice, "Minha conta de luz vence todo dia 10");
  const bills = await pendingBills(db, soloAccess(alice));
  assert.equal(bills.length, 1);
  assert.equal(bills[0].dueDate!.slice(8), "10");
  const mem = await db.select().from(schema.aiMemory).where(eq(schema.aiMemory.userId, alice.id));
  assert.equal(mem.length, 1);
});

test("rotina semanal vira compromisso recorrente", async () => {
  await handleMessage(db, alice, "Meu filho Gabriel tem futebol toda terça às 18h");
  const next14 = await occurrences(db, soloAccess(alice), today(), addDays(today(), 13));
  assert.equal(next14.filter((o) => o.event.recurrence === "WEEKLY").length, 2);
});

test("isolamento: Bob não consegue concluir a tarefa da Alice pelo id", async () => {
  await handleMessage(db, alice, "Preciso renovar o seguro do carro");
  const [t] = await openTasks(db, soloAccess(alice));
  const res = await executeActions(db, soloAccess(bob), today(), [{ type: "complete_task", id: t.id }]);
  assert.equal(res.executed.length, 0);
  assert.equal(res.skipped, 1);
  const [still] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
  assert.equal(still.status, "OPEN");
  assert.equal((await openTasks(db, soloAccess(bob))).length, 0);
});

test("isolamento: sugestão de outro usuário não pode ser respondida", async () => {
  const r = await handleMessage(db, alice, "Tenho dentista dia 20 às 14h");
  await assert.rejects(answerSuggestion(db, bob, r.assistant.id, true), /já foi respondida/);
});

test("plano grátis: financeiro bloqueado, compras liberadas", async () => {
  const r = await handleMessage(db, free, "Gastei 80 reais no mercado");
  assert.match(r.assistant.content, /Premium/);
  assert.equal((await monthFinance(db, free.id, today())).expenseCents, 0);
  await handleMessage(db, free, "Preciso comprar feijão");
  assert.equal((await shoppingOpen(db, soloAccess(free))).length, 1);
});

test("plano grátis: limite de 50 interações por mês", async () => {
  const month = today().slice(0, 7);
  await db.update(schema.usageCounters).set({ interactions: 50 }).where(eq(schema.usageCounters.userId, free.id));
  const [row] = await db.select().from(schema.usageCounters).where(eq(schema.usageCounters.userId, free.id));
  assert.equal(row.month, month);
  await assert.rejects(handleMessage(db, free, "oi"), /interações/);
});

test("saída da IA inválida é descartada, não quebra", () => {
  const out = parseNinaOutput({
    reply: "Pronto!",
    actions: [
      { type: "add_event", title: "X", date: "2026-02-30" },       // data impossível
      { type: "drop_table", table: "users" },                     // ação inexistente
      { type: "add_transaction", kind: "expense", amount: -5, category: "x", description: "y" }, // valor negativo
      { type: "add_task", title: "Ligar para o João" },
    ],
  });
  assert.equal(out.actions.length, 1);
  assert.equal(out.invalid, 3);
});

test("interpretador por regras: datas e valores em português", () => {
  const t = "2026-09-29"; // terça-feira
  const a = fallbackNina("Sexta tenho que levar o carro na oficina às 9h", t);
  assert.equal((a.actions[0] as { date: string }).date, "2026-10-02");
  const b = fallbackNina("Me lembra de ligar para o João amanhã", t);
  assert.equal((b.actions[0] as { date: string }).date, "2026-09-30");
  assert.equal((b.actions[0] as { text: string }).text, "Ligar para o João");
  const c = fallbackNina("Paguei uma conta", t);
  assert.match(c.reply, /Qual conta e qual foi o valor/);
  const d = fallbackNina("Recebi 8.500 reais de salário", t);
  assert.equal((d.actions[0] as { amount: number }).amount, 8500);
});

test("interpretador por regras: várias coisas numa frase só", () => {
  const t = "2026-09-29"; // terça-feira
  const r = fallbackNina("Amanhã preciso levar meu filho ao médico às 15h e depois passar no mercado. Também preciso pagar a conta de luz sexta-feira.", t);
  const types = r.actions.map((a) => a.type);
  assert.deepEqual(types, ["add_event", "add_task", "add_bill"]);
  assert.deepEqual(r.actions[0], { type: "add_event", title: "Levar meu filho ao médico", date: "2026-09-30", time: "15:00", recur: undefined });
  assert.equal((r.actions[1] as { due: string }).due, "2026-09-30");
  assert.equal((r.actions[2] as { dueDate: string }).dueDate, "2026-10-02");
  assert.ok(r.suggestion);
});

