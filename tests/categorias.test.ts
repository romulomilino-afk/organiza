/**
 * Categorias de cada pessoa: criação por conversa, palavras-chave, mudança dos lançamentos antigos e isolamento.
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
import { loadCategories } from "../src/lib/data/user-categories";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";
import { CATEGORIES } from "../src/lib/categories";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
const mk = async (email: string, plan: "FREE" | "PREMIUM" = "PREMIUM") => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan, onboarded: true }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, a: Record<string, unknown>) => executeActions(db, soloAccess(u), "2026-10-02", [ActionSchema.parse(a)]);
const expensesOf = async (userId: string) =>
  Object.fromEntries((await db.select().from(schema.expenses).where(eq(schema.expenses.userId, userId))).map((e) => [e.description, e.categoryKey]));

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  for (const [key, c] of Object.entries(CATEGORIES)) {
    await db.insert(schema.categories).values({ userId: null, key, name: c.name, emoji: c.emoji, kind: c.kind });
  }
});

test("criar categoria por conversa move os lançamentos antigos e vale para os novos", async () => {
  const u = await mk("cat@x.com");
  await handleMessage(db, u, "Gastei 40 reais na barbearia");
  await handleMessage(db, u, "Gastei 120 reais na academia");
  assert.deepEqual(await expensesOf(u.id), { Barbearia: "outros", Academia: "saude" });

  const r = await handleMessage(db, u, "barbearia vai na categoria Beleza");
  assert.match(r.assistant.content, /Beleza/);
  await handleMessage(db, u, "coloca academia na categoria Academia");
  assert.deepEqual(await expensesOf(u.id), { Barbearia: "beleza", Academia: "academia" });

  // gasto novo já cai na categoria da pessoa, e a resposta diz o nome certo
  const novo = await handleMessage(db, u, "Gastei 35 reais na barbearia hoje");
  assert.match(novo.assistant.content, /em Beleza/);
  const cats = await loadCategories(db, u.id);
  assert.deepEqual(cats.custom().map((c) => [c.key, c.name, c.emoji, c.keywords]), [
    ["beleza", "Beleza", "💈", ["barbearia"]],
    ["academia", "Academia", "🏋️", ["academia"]],
  ]);

  // mais uma palavra na mesma categoria não duplica nem troca o emoji
  await run(u, { type: "add_category", name: "beleza", emoji: "💅", keywords: ["manicure"] });
  const beleza = (await loadCategories(db, u.id)).find("Beleza")!;
  assert.deepEqual([beleza.emoji, beleza.keywords], ["💈", ["barbearia", "manicure"]]);
});

test("palavra-chave da pessoa vence a categoria que a IA sugerir; categoria padrão ganha palavras", async () => {
  const u = await mk("ia@x.com");
  await run(u, { type: "add_category", name: "Saúde", keywords: ["academia"] });
  await run(u, { type: "add_transaction", kind: "expense", amount: 99, category: "lazer", description: "Mensalidade da academia" });
  await run(u, { type: "add_transaction", kind: "expense", amount: 10, category: "categoria_inventada", description: "Coisa" });
  assert.deepEqual(await expensesOf(u.id), { "Mensalidade da academia": "saude", Coisa: "outros" });
  const cats = await loadCategories(db, u.id);
  assert.equal(cats.custom().length, 0, "Saúde continua sendo padrão, só com palavras-chave");
  assert.deepEqual(cats.get("saude").keywords, ["academia"]);
});

test("apagar categoria manda os lançamentos para Outros; não apaga as padrão; cada um vê só as suas", async () => {
  const u = await mk("del@x.com");
  await run(u, { type: "add_category", name: "Pet", emoji: "🐶", keywords: ["ração", "veterinário"] });
  await run(u, { type: "add_transaction", kind: "expense", amount: 80, category: "outros", description: "Racao do Thor" });
  assert.equal((await expensesOf(u.id))["Racao do Thor"], "pet", "acento não atrapalha");

  const outro = await mk("outro@x.com");
  assert.equal((await loadCategories(db, outro.id)).find("Pet"), null);
  const tentativa = await run(outro, { type: "delete_category", name: "Pet" });
  assert.equal(tentativa.skipped, 1);

  assert.equal((await run(u, { type: "delete_category", name: "Alimentação" })).skipped, 1);
  await run(u, { type: "delete_category", name: "pet" });
  assert.equal((await expensesOf(u.id))["Racao do Thor"], "outros");
  assert.equal((await loadCategories(db, u.id)).find("Pet"), null);
});

test("categoria de receita e plano Grátis", async () => {
  const u = await mk("rec@x.com");
  await handleMessage(db, u, "nova categoria de receita Freelas com freela");
  await run(u, { type: "add_transaction", kind: "income", amount: 500, category: "renda_extra", description: "Freela do site" });
  const [inc] = await db.select().from(schema.income).where(eq(schema.income.userId, u.id));
  assert.equal(inc.categoryKey, "freelas");

  const free = await mk("free@x.com", "FREE");
  await handleMessage(db, free, "cria a categoria Beleza");
  assert.equal((await loadCategories(db, free.id)).custom().length, 0);
});
