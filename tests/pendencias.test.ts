/**
 * "Não deixe nada passar", Assistente de Pendências e "Posso gastar?".
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { soloAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { computeAlerts } from "../src/lib/data/alerts";
import { buildPendencias } from "../src/lib/data/pendencias";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";
import { completeDeadline, ensureRoutines, openDeadlines, parseMonthDate } from "../src/lib/watch";
import { explainFree, explainSimulation, monthBudget, simulate } from "../src/lib/budget";
import { todayIn } from "../src/lib/dates";

delete process.env.ANTHROPIC_API_KEY;
const TZ = "America/Sao_Paulo";
let db: DB;
const mk = async (email: string, plan: "FREE" | "PREMIUM" = "PREMIUM") => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan, onboarded: true, timezone: TZ, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, today: string, ...as: Record<string, unknown>[]) => executeActions(db, soloAccess(u), today, as.map((a) => ActionSchema.parse(a)));
const noDismiss = async () => new Set<string>();

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("datas por mês: 'em dezembro', '20 de dezembro', 'março de 2028', mês que já passou vai para o ano que vem", () => {
  assert.deepEqual(parseMonthDate("meu seguro vence em dezembro", "2026-10-05"), { date: "2026-12-01", exactDay: false });
  assert.deepEqual(parseMonthDate("vence dia 20 de dezembro", "2026-10-05"), { date: "2026-12-20", exactDay: true });
  assert.deepEqual(parseMonthDate("CNH vence em março de 2028", "2026-10-05"), { date: "2028-03-01", exactDay: false });
  assert.deepEqual(parseMonthDate("o IPVA vence em janeiro", "2026-10-05"), { date: "2027-01-01", exactDay: false });
  assert.equal(parseMonthDate("amanhã", "2026-10-05"), null);
});

test("pela conversa: seguro, garantia, compra de rotina e problema em casa", async () => {
  const u = await mk("nada@x.com");
  const today = todayIn(TZ);

  const seg = await handleMessage(db, u, "Meu seguro do carro vence dia 20 de dezembro.");
  assert.match(seg.assistant.content, /Seguro do carro/);
  const [d] = await openDeadlines(db, u.id);
  assert.deepEqual([d.name, d.remindDaysBefore, d.renewMonths, d.kind], ["Seguro do carro", 30, 12, "seguro"]);

  const tv = await handleMessage(db, u, "Comprei uma televisão hoje, a garantia é de 12 meses.");
  assert.match(tv.assistant.content, /garantia até/);
  const [w] = await db.select().from(schema.warranties).where(eq(schema.warranties.userId, u.id));
  assert.deepEqual([w.item, w.months], ["Televisão", 12]);

  await handleMessage(db, u, "Preciso comprar ração quando estiver acabando.");
  const [r] = await db.select().from(schema.shoppingRoutines).where(eq(schema.shoppingRoutines.userId, u.id));
  assert.deepEqual([r.name, r.everyDays], ["Ração", 30]);

  const prob = await handleMessage(db, u, "Minha geladeira está fazendo um barulho estranho, preciso chamar alguém para olhar.");
  assert.match(prob.assistant.content, /geladeira/);
  const sug = (prob.assistant as unknown as { suggestion?: { text: string } }).suggestion;
  assert.match(sug?.text ?? "", /tarefa para amanhã às 10h/);
  // "Sim": a tarefa com horário também cria o lembrete na hora
  await run(u, today, { type: "add_task", title: "Chamar alguém para ver a geladeira", due: "2026-10-06", time: "10:00" });
  const rem = await db.select().from(schema.reminders).where(eq(schema.reminders.userId, u.id));
  assert.deepEqual(rem.map((x) => [x.text, x.date, x.time]), [["Chamar alguém para ver a geladeira", "2026-10-06", "10:00"]]);
});

test("compra de rotina volta para a lista sozinha e recomeça quando a pessoa compra", async () => {
  const u = await mk("racao@x.com");
  const a = soloAccess(u);
  await run(u, "2026-10-05", { type: "add_shopping_routine", item: "ração", everyDays: 30 });
  await ensureRoutines(db, a, "2026-10-20");
  let list = await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.userId, u.id));
  assert.equal(list.length, 0, "ainda não chegou o dia");

  await ensureRoutines(db, a, "2026-11-04");
  await ensureRoutines(db, a, "2026-11-04");
  list = await db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.userId, u.id));
  assert.deepEqual(list.map((i) => [i.name, i.checked]), [["Ração", false]], "entra uma vez só");

  // comprou no dia 10/11 → próxima em 10/12
  await run(u, "2026-11-10", { type: "check_shopping", items: ["Ração"] });
  const [r] = await db.select().from(schema.shoppingRoutines).where(eq(schema.shoppingRoutines.userId, u.id));
  assert.equal(r.nextDate, "2026-12-10");
});

test("vencimento: avisos por marco, renovação anual e lista de pendências por cor", async () => {
  const u = await mk("venc@x.com");
  await run(u, "2026-10-05", { type: "add_deadline", name: "Seguro do carro", date: "2026-10-28", renewMonths: 12, kind: "seguro" });
  await run(u, "2026-10-05", { type: "add_deadline", name: "CNH", date: "2027-03-01", kind: "documento" });
  const dls = await openDeadlines(db, u.id);
  const alerts = computeAlerts({ today: "2026-10-05", tz: TZ, events: [], bills: [], tasks: [], shopping: [], reminders: [], deadlines: dls });
  assert.deepEqual(alerts.map((x) => x.text), ["Seguro do carro vence em 23 dias (28/10/2026)."], "CNH ainda fora da janela de 30 dias");

  // pendências do dia: tarefa atrasada (🔴), tarefa de hoje (🟡), dentista (🔵), seguro (🟢)
  await run(u, "2026-10-05", { type: "add_task", title: "Pagar o IPTU", due: "2026-10-01" }, { type: "add_task", title: "Buscar roupa na lavanderia", due: todayIn(TZ) },
    { type: "add_event", title: "Dentista", date: todayIn(TZ), time: "15:00" });
  const p = await buildPendencias(db, soloAccess(u), todayIn(TZ), noDismiss);
  const colors = p.map((x) => x.color);
  assert.deepEqual([...colors].sort((a, b) => ["red", "yellow", "blue", "green"].indexOf(a) - ["red", "yellow", "blue", "green"].indexOf(b)), colors, "ordenado por cor");
  assert.ok(p.some((x) => x.color === "red" && x.text === "Pagar o IPTU"));
  assert.ok(p.some((x) => x.color === "blue" && x.text === "Dentista às 15h"));

  const seguro = dls.find((x) => x.name === "Seguro do carro")!;
  const renovado = await completeDeadline(db, u.id, seguro.id);
  assert.deepEqual([renovado?.dueDate, renovado?.done], ["2027-10-28", false]);
  const cnh = dls.find((x) => x.name === "CNH")!;
  assert.equal((await completeDeadline(db, u.id, cnh.id))?.done, true);
});

test("Posso gastar?: margem do mês com renda prevista, fixos, contas, cartão e assinaturas", async () => {
  const u = await mk("gastar@x.com");
  const T = "2026-10-02";
  await run(u, T,
    { type: "add_fixed", kind: "income", name: "Salário", amount: 4200, day: 5, category: "salario" },
    { type: "add_fixed", kind: "expense", name: "Aluguel", amount: 1500, day: 10, category: "casa" },
    { type: "add_bill", name: "Escola", amount: 900, dueDate: "2026-10-15", recurring: false },
    { type: "add_transaction", kind: "expense", amount: 45, category: "alimentacao", description: "Almoço", date: T },
    { type: "add_card", name: "Nubank", closingDay: 3, dueDay: 10 },
    { type: "add_card_purchase", description: "Notebook", amount: 3000, installments: 10, category: "compras", date: T },
    { type: "add_subscription", name: "Netflix", amount: 40, cycle: "monthly" });
  await db.update(schema.recurringItems).set({ createdAt: new Date("2026-10-01T15:00:00Z") }).where(eq(schema.recurringItems.userId, u.id));

  const b = await monthBudget(db, u.id, T, TZ);
  // receita 4.200 (vai cair dia 5) − gasto 45 − parcela 300 (vence 10/10) − escola 900 − aluguel 1.500 − Netflix 40
  assert.equal(b.incomeCents, 420000);
  assert.equal(b.committedCents, 4500 + 30000 + 90000 + 150000 + 4000);
  assert.equal(b.marginCents, 141500);
  assert.equal(b.cushionCents, 42000);
  assert.equal(b.freeCents, 99500);
  assert.equal(b.daysLeft, 30);
  assert.match(explainFree(b), /até R\$\s995,00 este mês/);

  // celular de 1.500 à vista: não cabe; em 10x cabe
  const s1 = simulate(b, 150000, 1);
  assert.equal(s1.verdict, "nao");
  assert.ok(s1.suggestion && s1.suggestion >= 2);
  assert.match(explainSimulation(b, 150000, 1), /margem deste mês iria de R\$\s1\.415,00 para -R\$\s85,00/);
  assert.equal(simulate(b, 150000, 10).verdict, "ok");
  assert.match(explainSimulation(b, 120000, 1), /^Dá para comprar, mas fica apertado/);

  // pela conversa (modo simples)
  const r = await handleMessage(db, u, "Posso comprar um celular de R$ 1.500?");
  assert.match(r.assistant.content, /margem deste mês/);
  const q = await handleMessage(db, u, "Quanto posso gastar esse mês sem me apertar?");
  assert.match(q.assistant.content, /Você pode gastar até/);
});

test("sem renda cadastrada a Nina pede a renda; plano Grátis não tem o Posso gastar", async () => {
  const u = await mk("semrenda@x.com");
  const r = await handleMessage(db, u, "quanto posso gastar este mês?");
  assert.match(r.assistant.content, /preciso saber sua renda/);
  const free = await mk("free5@x.com", "FREE");
  const f = await handleMessage(db, free, "posso comprar um tênis de 300?");
  assert.match(f.assistant.content, /plano Premium/);
});
