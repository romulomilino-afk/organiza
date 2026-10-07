/** Teste grátis de 7 dias: tudo liberado, depois volta para o Grátis. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../src/db/schema";
import { eq } from "drizzle-orm";
import type { DB } from "../src/db";
import { getAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { handleMessage } from "../src/lib/nina";
import { createHousehold } from "../src/lib/family";
import { planWithTrial, trialInfo, TRIAL_DAYS } from "../src/lib/plans";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
const DAY = 86_400_000;
before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("cadastro novo ganha 7 dias com tudo liberado (como Família)", async () => {
  assert.equal(TRIAL_DAYS, 7);
  const [u] = await db.insert(schema.users).values({ email: "novo@x.com", name: "Novo", onboarded: true }).returning();
  await ensureUserSetup(db, u.id);
  const days = (u.trialEndsAt!.getTime() - Date.now()) / DAY;
  assert.ok(days > 6.9 && days <= 7, `teste de ${days} dias`);
  const a = await getAccess(db, u);
  assert.equal(a.plan, "FAMILY");
  assert.equal(a.trial?.active, true);
  assert.equal(a.trial?.daysLeft, 7);
  const r = await handleMessage(db, u, "gastei 45 reais no almoço");
  const gastos = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id));
  assert.equal(gastos.length, 1, r.assistant.content);
  await createHousehold(db, u, "Casa"); // família liberada no teste
});

test("acabou o teste: volta para o Grátis e a Nina pede para assinar", async () => {
  const [u] = await db.insert(schema.users).values({ email: "fim@x.com", name: "Fim", onboarded: true, trialEndsAt: new Date(Date.now() - DAY) }).returning();
  await ensureUserSetup(db, u.id);
  const a = await getAccess(db, u);
  assert.equal(a.plan, "FREE");
  assert.equal(a.trial?.active, false);
  const r = await handleMessage(db, u, "gastei 45 reais no almoço");
  assert.match(r.assistant.content, /teste grátis acabou/);
  assert.equal((await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id))).length, 0);
  await assert.rejects(() => createHousehold(db, u, "Casa"));
});

test("quem paga não é afetado pelo teste", () => {
  assert.equal(planWithTrial("PREMIUM", new Date(Date.now() + DAY)), "PREMIUM");
  assert.equal(trialInfo("PREMIUM", new Date(Date.now() + DAY)), null);
  assert.equal(planWithTrial("FREE", null), "FREE");
});
