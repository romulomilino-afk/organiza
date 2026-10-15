/** Saúde financeira: regra de cores da barrinha. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { financialHealth } from "../src/lib/health";
import type { Budget } from "../src/lib/budget";

const b = (incomeCents: number, marginCents: number, nextMargin = 100_00, hasIncome = true) =>
  ({ hasIncome, incomeCents, marginCents, next: { incomeCents: hasIncome ? incomeCents : 0, marginCents: nextMargin } }) as unknown as Budget;
const none = { overdueBills: 0, overdueInvoices: 0 };

test("verde quando sobra 10% ou mais", () => {
  const h = financialHealth(b(5000_00, 1000_00), none);
  assert.equal(h.level, "verde");
  assert.equal(h.percent, 20);
  assert.ok(h.position > 0.66);
});

test("amarelo quando sobra menos de 10%", () => {
  const h = financialHealth(b(5000_00, 200_00), none);
  assert.equal(h.level, "amarelo");
  assert.match(h.reasons[0], /Sobram só/);
  assert.ok(h.position > 0.33 && h.position < 0.67);
});

test("vermelho quando os compromissos passam a renda, com dica da reserva", () => {
  const h = financialHealth(b(5000_00, -300_00), { ...none, reserveCents: 800_00 });
  assert.equal(h.level, "vermelho");
  assert.ok(h.position < 0.33);
  assert.match(h.tip!, /reserva/);
});

test("conta atrasada ou mês que vem no vermelho rebaixam o verde para amarelo", () => {
  const late = financialHealth(b(5000_00, 1500_00), { overdueBills: 2, overdueInvoices: 1 });
  assert.equal(late.level, "amarelo");
  assert.ok(late.reasons.some((r) => /2 contas atrasadas e 1 fatura de cartão atrasada/.test(r)));
  assert.ok(late.position <= 0.62);
  const next = financialHealth(b(5000_00, 1500_00, -200_00), none);
  assert.equal(next.level, "amarelo");
});

test("sem renda: cinza, pede a renda", () => {
  const h = financialHealth(b(0, 0, 0, false), none);
  assert.equal(h.level, "sem_dados");
  assert.match(h.reasons[0], /renda/);
});
