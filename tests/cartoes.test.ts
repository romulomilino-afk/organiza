/**
 * Cartões de crédito: fatura certa para cada parcela, faturas, pagamento, cancelamento e integração com o mês.
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { asc, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { soloAccess } from "../src/lib/access";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { monthFinance } from "../src/lib/data/queries";
import { computeAlerts } from "../src/lib/data/alerts";
import { executeActions } from "../src/lib/nina/executor";
import { ActionSchema } from "../src/lib/nina/actions";
import { handleMessage } from "../src/lib/nina";
import { bestDay, cardsOverview, closingDateFor, firstDueDate, installmentDueDate, splitInstallments, unpaidInvoicesDue } from "../src/lib/cards";

delete process.env.ANTHROPIC_API_KEY;
let db: DB;
const mk = async (email: string, plan: "FREE" | "PREMIUM" = "PREMIUM") => {
  const [u] = await db.insert(schema.users).values({ email, name: email.split("@")[0], plan, onboarded: true }).returning();
  await ensureUserSetup(db, u.id);
  return u;
};
const run = (u: schema.User, today: string, ...as: Record<string, unknown>[]) => executeActions(db, soloAccess(u), today, as.map((a) => ActionSchema.parse(a)));
const inst = (userId: string) => db.select().from(schema.cardInstallments).where(eq(schema.cardInstallments.userId, userId)).orderBy(asc(schema.cardInstallments.dueDate), asc(schema.cardInstallments.number));

before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
});

test("cálculo: fatura certa, virada de mês, fim de mês e melhor dia", () => {
  // fecha 3, vence 10
  assert.equal(firstDueDate("2026-10-02", 3, 10), "2026-10-10");
  assert.equal(firstDueDate("2026-10-03", 3, 10), "2026-11-10", "no dia do fechamento já vai para a próxima");
  assert.equal(installmentDueDate("2026-10-02", 3, 10, 10), "2027-07-10");
  // fecha 25, vence 5 (vence no mês seguinte ao fechamento)
  assert.equal(firstDueDate("2026-10-24", 25, 5), "2026-11-05");
  assert.equal(firstDueDate("2026-10-25", 25, 5), "2026-12-05");
  assert.equal(closingDateFor("2026-11-05", 25, 5), "2026-10-25");
  // vencimento dia 31 em fevereiro
  assert.equal(installmentDueDate("2026-12-01", 20, 31, 3), "2027-02-28");
  assert.deepEqual(splitInstallments(100000, 3), [33334, 33333, 33333]);
  assert.equal(splitInstallments(100000, 3).reduce((a, b) => a + b), 100000);
  assert.deepEqual([bestDay({ closingDay: 3 }, "2026-10-02").goodNow, bestDay({ closingDay: 3 }, "2026-10-04").goodNow], [false, true]);
});

test("compra parcelada: parcelas nas faturas, mês, fatura a pagar, pagamento e avisos", async () => {
  const u = await mk("card@x.com");
  await run(u, "2026-10-02", { type: "add_card", name: "nubank", closingDay: 3, dueDay: 10, limit: 5000 });
  const r = await run(u, "2026-10-02", { type: "add_card_purchase", card: "Nubank", description: "TV", amount: 3000, installments: 10, category: "compras" });
  assert.equal(r.cards[0].title, "TV · R$ 3.000,00");
  const rows = await inst(u.id);
  assert.equal(rows.length, 10);
  assert.deepEqual([rows[0].dueDate, rows[9].dueDate], ["2026-10-10", "2027-07-10"]);
  assert.equal(rows.reduce((a, x) => a + x.amountCents, 0), 300000);

  // 10x de 150 (valor da parcela) e compra à vista
  await run(u, "2026-10-05", { type: "add_card_purchase", card: "nu", description: "Celular", installmentAmount: 150, installments: 12, category: "compras" });
  await run(u, "2026-10-05", { type: "add_transaction", kind: "expense", amount: 80, category: "alimentacao", description: "Mercado", method: "cartao" });
  const exp = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, u.id));
  assert.equal(exp.length, 0, "compra no cartão não vira despesa solta");

  // o mês de outubro conta só a 1ª parcela da TV (vence 10/10)
  const fin = await monthFinance(db, u.id, "2026-10-05");
  assert.equal(fin.cardCents, 30000);
  assert.equal(fin.byCategory.compras, 30000);
  // novembro: TV + celular + mercado
  assert.equal((await monthFinance(db, u.id, "2026-11-15")).cardCents, 30000 + 15000 + 8000);

  // dia 05/10: a fatura de 10/10 já fechou (dia 3) → "a pagar"; a de 10/11 está aberta
  let [ov] = await cardsOverview(db, u.id, "2026-10-05");
  assert.equal(ov.toPay?.dueDate, "2026-10-10");
  assert.equal(ov.toPay?.totalCents, 30000);
  assert.equal(ov.open?.dueDate, "2026-11-10");
  assert.equal(ov.open?.totalCents, 30000 + 15000 + 8000);
  assert.equal(ov.usedCents, 300000 + 180000 + 8000);
  assert.equal(ov.purchases.find((p) => p.description === "TV")?.remaining, 10);

  // aviso 2 dias antes do vencimento
  const alerts = computeAlerts({ today: "2026-10-08", tz: "America/Sao_Paulo", events: [], bills: [], tasks: [], shopping: [], reminders: [],
    invoices: await unpaidInvoicesDue(db, u.id, "2026-10-08", "2026-10-11") });
  assert.match(alerts[0].text, /fatura do Nubank vence em 2 dias/);

  // "paguei a fatura" pela conversa (regra) → paga a de 10/10
  const pay = await run(u, "2026-10-09", { type: "pay_invoice", card: "Nubank" });
  assert.equal(pay.cards[0].title, "Fatura Nubank paga");
  [ov] = await cardsOverview(db, u.id, "2026-10-09");
  assert.equal(ov.toPay, null);
  assert.equal(ov.purchases.find((p) => p.description === "TV")?.next, 2);
  assert.equal((await unpaidInvoicesDue(db, u.id, "2026-10-09", "2026-11-30")).length, 0);

  // cancelar a TV: some das faturas não pagas, a paga continua
  const tv = ov.purchases.find((p) => p.description === "TV")!;
  await run(u, "2026-10-09", { type: "cancel_card_purchase", id: tv.purchaseId });
  const left = (await inst(u.id)).filter((i) => i.purchaseId === tv.purchaseId);
  assert.deepEqual(left.map((i) => i.dueDate), ["2026-10-10"]);
});

test("mudar o fechamento recalcula as parcelas não pagas; outra pessoa não mexe", async () => {
  const u = await mk("muda@x.com");
  await run(u, "2026-10-02", { type: "add_card", name: "Inter", closingDay: 3, dueDay: 10 });
  await run(u, "2026-10-02", { type: "add_card_purchase", description: "Sofá", amount: 1200, installments: 3, category: "casa" });
  await run(u, "2026-10-02", { type: "update_card", card: "inter", closingDay: 25, dueDay: 5 });
  assert.deepEqual((await inst(u.id)).map((i) => i.dueDate), ["2026-11-05", "2026-12-05", "2027-01-05"]);

  const outro = await mk("intruso2@x.com");
  const [p] = await db.select().from(schema.cardPurchases).where(eq(schema.cardPurchases.userId, u.id));
  assert.equal((await run(outro, "2026-10-02", { type: "cancel_card_purchase", id: p.id })).skipped, 1);
  assert.equal((await run(outro, "2026-10-02", { type: "pay_invoice", card: "Inter" })).skipped, 1);
  assert.equal((await inst(u.id)).length, 3);
});

test("Nina (modo simples): cadastrar cartão e compra parcelada pela conversa; Grátis não tem", async () => {
  const u = await mk("conversa@x.com");
  await handleMessage(db, u, "meu Nubank fecha dia 3 e vence dia 10 limite 4.000");
  const [card] = await db.select().from(schema.creditCards).where(eq(schema.creditCards.userId, u.id));
  assert.deepEqual([card.name, card.closingDay, card.dueDay, card.limitCents], ["Nubank", 3, 10, 400000]);

  const r = await handleMessage(db, u, "comprei uma geladeira de 2.500 em 10x no Nubank");
  assert.match(r.assistant.content, /10x de R\$\s250,00/);
  const [p] = await db.select().from(schema.cardPurchases).where(eq(schema.cardPurchases.userId, u.id));
  assert.deepEqual([p.description, p.totalCents, p.installments], ["Geladeira", 250000, 10]);

  const free = await mk("free3@x.com", "FREE");
  await handleMessage(db, free, "meu Nubank fecha dia 3 e vence dia 10");
  assert.equal((await db.select().from(schema.creditCards).where(eq(schema.creditCards.userId, free.id))).length, 0);
});

test("limite: alterar pela conversa, consultar e editar pela tela (mesmo nome atualiza)", async () => {
  const u = await mk("limite@x.com");
  await run(u, "2026-10-02", { type: "add_card", name: "Nubank", closingDay: 3, dueDay: 10 });
  await run(u, "2026-10-02", { type: "add_card_purchase", description: "Fone", amount: 600, installments: 3, category: "compras" });
  await handleMessage(db, u, "o limite do Nubank agora é 8.000");
  let [c] = await db.select().from(schema.creditCards).where(eq(schema.creditCards.userId, u.id));
  assert.equal(c.limitCents, 800000);
  const q = await handleMessage(db, u, "qual meu limite?");
  assert.match(q.assistant.content, /limite R\$\s8\.000,00, usado R\$\s600,00, disponível R\$\s7\.400,00/);
  // formulário "Editar" manda add_card com o mesmo nome → atualiza em vez de duplicar
  await run(u, "2026-10-02", { type: "add_card", name: "nubank", closingDay: 3, dueDay: 10, limit: 9000 });
  const all = await db.select().from(schema.creditCards).where(eq(schema.creditCards.userId, u.id));
  assert.equal(all.length, 1);
  assert.equal(all[0].limitCents, 900000);
});
