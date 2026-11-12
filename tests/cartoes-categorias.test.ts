/**
 * Categorias no cartão de crédito: a Nina põe a categoria, a tela mostra por cartão, dá para trocar
 * e a palavra-chave de categoria também vale para compras no cartão.
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
import { monthFinance } from "../src/lib/data/queries";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";
import { cardsOverview, setPurchaseCategory, sumByCategory } from "../src/lib/cards";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
const mk = async (email: string) => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan: "PREMIUM", onboarded: true, trialEndsAt: null }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, today: string, ...as: Record<string, unknown>[]) => executeActions(db, soloAccess(u), today, as.map((a) => ActionSchema.parse(a)));

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("soma por categoria ordena do maior para o menor", () => {
  assert.deepEqual(sumByCategory([
    { categoryKey: "saude", amountCents: 100 }, { categoryKey: "compras", amountCents: 900 }, { categoryKey: "saude", amountCents: 50 },
  ]), [{ key: "compras", cents: 900 }, { key: "saude", cents: 150 }]);
});

test("tênis de 900 em 10x no Itaú: entra em Compras, por cartão e no mês", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-11T15:00:00Z") });
  const u = await mk("cat-card@x.com");
  await run(u, "2026-11-11", { type: "add_card", name: "Itaú", closingDay: 3, dueDay: 10, limit: 8000 },
    { type: "add_card", name: "Nubank", closingDay: 25, dueDay: 5 });

  const r = await handleMessage(db, u, "nina comprei um tênis de 900,00 parcelado em 10x de 90,00 no cartão de crédito Itaú");
  assert.match(r.assistant.content, /Categoria: Compras/);
  assert.match(r.assistant.content, /^Lancei Tênis no Itaú: 10x de R\$\s90,00/);
  await run(u, "2026-11-11", { type: "add_card_purchase", card: "Itaú", description: "Farmácia", amount: 120, installments: 1, category: "saude" },
    { type: "add_card_purchase", card: "Nubank", description: "Mercado", amount: 300, installments: 1, category: "alimentacao" });

  const ov = await cardsOverview(db, u.id, "2026-11-11");
  const itau = ov.find((c) => c.card.name === "Itaú")!;
  const tenis = itau.purchases.find((p) => /t[eê]nis/i.test(p.description))!;
  assert.equal(tenis.categoryKey, "compras");
  assert.equal(tenis.of, 10);
  // fatura aberta do Itaú (vence 10/12): 1ª parcela do tênis + farmácia
  assert.deepEqual(itau.openByCategory, [{ key: "saude", cents: 12000 }, { key: "compras", cents: 9000 }]);
  // tudo que falta pagar no Itaú: tênis inteiro + farmácia
  assert.deepEqual(itau.unpaidByCategory, [{ key: "compras", cents: 90000 }, { key: "saude", cents: 12000 }]);
  const nu = ov.find((c) => c.card.name === "Nubank")!;
  assert.deepEqual(nu.openByCategory, [{ key: "alimentacao", cents: 30000 }]);

  // trocar a categoria do tênis vale para todas as parcelas e para o mês
  assert.equal(await setPurchaseCategory(db, u.id, tenis.purchaseId, "lazer"), true);
  const [again] = (await cardsOverview(db, u.id, "2026-11-11")).filter((c) => c.card.name === "Itaú");
  assert.deepEqual(again.unpaidByCategory, [{ key: "lazer", cents: 90000 }, { key: "saude", cents: 12000 }]);
  const dez = await monthFinance(db, u.id, "2026-12-15");
  assert.equal(dez.byCategory.lazer, 9000);

  // outra pessoa não consegue mexer na compra
  const other = await mk("outro-cat@x.com");
  assert.equal(await setPurchaseCategory(db, other.id, tenis.purchaseId, "casa"), false);
});

test("categoria nova com palavra-chave também move compras no cartão", async () => {
  const u = await mk("kw-card@x.com");
  await run(u, "2026-11-11", { type: "add_card", name: "Itaú", closingDay: 3, dueDay: 10 });
  await run(u, "2026-11-11", { type: "add_card_purchase", card: "Itaú", description: "Tênis de corrida", amount: 500, installments: 5, category: "compras" });
  await run(u, "2026-11-11", { type: "add_category", name: "Esporte", emoji: "🏃", kind: "expense", keywords: ["tênis"] });
  const [p] = await db.select().from(schema.cardPurchases).where(eq(schema.cardPurchases.userId, u.id));
  assert.equal(p.categoryKey, "esporte");
});
