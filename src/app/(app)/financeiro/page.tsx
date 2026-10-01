import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { MESES, relDay, todayIn, fmtShort } from "@/lib/dates";
import { brl, METHOD_LABEL } from "@/lib/money";
import { category } from "@/lib/categories";
import { hasFeature, type PlanId } from "@/lib/plans";
import { activeSubscriptions, ensureRecurringBills, fixedItems, householdFinance, monthFinance, pendingBills } from "@/lib/data/queries";
import { addFixed, cancelFixed } from "@/actions/fixed";
import { deleteExpense, deleteIncome, payBill } from "@/actions/items";
import { Empty, PageHeader, SmallButton, XButton } from "@/components/ui";

export default async function FinanceiroPage() {
  const { user, access } = await requirePageAccess();
  if (!hasFeature(access.plan, "financeiro")) {
    return (
      <>
        <PageHeader title="Dinheiro" subtitle="Receitas, despesas e contas" />
        <div className="card flex flex-col gap-3">
          <p className="text-[17px]">Registre seus gastos só falando: “Gastei 45 reais no almoço”.</p>
          <p className="text-ink-2">O financeiro faz parte do plano Premium (R$ 14,90/mês), junto com memória, áudio e lembretes inteligentes.</p>
          <Link href="/config" className="btn w-fit">Ver planos</Link>
        </div>
      </>
    );
  }
  const db = getDb();
  const today = todayIn(user.timezone);
  await ensureRecurringBills(db, user.id, today, user.timezone);
  const [fin, bills, subs, fam, fixos] = await Promise.all([monthFinance(db, user.id, today), pendingBills(db, access), activeSubscriptions(db, user.id), householdFinance(db, access, today), fixedItems(db, user.id)]);

  const cats = Object.entries(fin.byCategory).sort((a, b) => b[1] - a[1]);
  const maxC = cats[0]?.[1] ?? 1;
  const tx = [
    ...fin.expenses.map((e) => ({ id: e.id, kind: "expense" as const, date: e.date, cents: e.amountCents ?? 0, desc: e.description, cat: e.categoryKey, method: e.method, at: e.createdAt, fixed: !!e.recurringItemId })),
    ...fin.incomes.map((i) => ({ id: i.id, kind: "income" as const, date: i.date, cents: i.amountCents, desc: i.description, cat: i.categoryKey, method: null, at: i.createdAt, fixed: !!i.recurringItemId })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.at.getTime() - a.at.getTime()).slice(0, 40);
  const subsMonthly = subs.reduce((a, s) => a + (s.cycle === "YEARLY" ? s.amountCents / 12 : s.amountCents), 0);

  return (
    <>
      <PageHeader title="Dinheiro" subtitle={`Este mês · ${MESES[Number(today.slice(5, 7)) - 1]}`} />
      <div className="flex flex-col gap-3">
        <div className="card">
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-[13px] font-semibold text-ink-3">Receitas</div><div className="num font-display text-[26px] font-semibold text-good">{brl(fin.incomeCents)}</div></div>
            <div><div className="text-[13px] font-semibold text-ink-3">Despesas</div><div className="num font-display text-[26px] font-semibold">{brl(fin.expenseCents)}</div></div>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <div className="text-[13px] font-semibold text-ink-3">Saldo</div>
            <div className={`num font-display text-[26px] font-semibold ${fin.balanceCents < 0 ? "text-bad" : ""}`}>{brl(fin.balanceCents)}</div>
          </div>
        </div>

        <div className="card">
          <div className="eyebrow mb-2">🔁 Fixos todo mês</div>
          {fixos.items.length > 0 && (
            <div className="mb-2 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-sm">
              <div><div className="text-ink-3">Entra</div><b className="num text-good">{brl(fixos.incomeCents)}</b></div>
              <div><div className="text-ink-3">Sai</div><b className="num">{brl(fixos.expenseCents)}</b></div>
              <div><div className="text-ink-3">Sobra</div><b className={`num ${fixos.leftoverCents < 0 ? "text-bad" : ""}`}>{brl(fixos.leftoverCents)}</b></div>
            </div>
          )}
          {fixos.items.length ? fixos.items.map((f) => {
            const inc = f.kind === "INCOME";
            const how = inc ? "entra sozinha" : f.kind === "EXPENSE" ? "lança sozinha" : "te aviso para pagar";
            return (
              <div key={f.id} className="row">
                <span className="text-xl">{inc ? "💵" : category(f.categoryKey ?? "casa").emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium [overflow-wrap:anywhere]">{f.name}</div>
                  <div className="text-[13px] text-ink-3">Todo dia {f.dayOfMonth} · {how}</div>
                </div>
                <span className={`num whitespace-nowrap font-semibold ${inc ? "text-good" : ""}`}>{f.amountCents ? `${inc ? "+" : "−"} ${brl(f.amountCents)}` : "—"}</span>
                <XButton action={cancelFixed.bind(null, f.id)} label={`Parar de lançar ${f.name}`} />
              </div>
            );
          }) : <Empty>Diga “meu salário de 4.200 cai todo dia 5” ou “pago 1.500 de aluguel todo dia 10”. Eu lanço sozinha todo mês.</Empty>}
          <details className="mt-2 border-t border-line pt-2">
            <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">+ Adicionar fixo</summary>
            <form action={addFixed} className="mt-2 flex flex-col gap-2">
              <select name="tipo" className="field" defaultValue="receita" aria-label="Tipo">
                <option value="receita">Receita fixa (entra sozinha)</option>
                <option value="despesa">Despesa fixa (lança sozinha)</option>
                <option value="conta">Conta fixa (me avisa para pagar)</option>
              </select>
              <input name="name" required maxLength={80} placeholder="Nome (ex.: Salário, Aluguel)" className="field" aria-label="Nome" />
              <div className="grid grid-cols-2 gap-2">
                <input name="amount" required inputMode="decimal" pattern="[0-9.,]+" placeholder="Valor (R$)" className="field" aria-label="Valor" />
                <input name="day" required type="number" min={1} max={31} inputMode="numeric" placeholder="Todo dia…" className="field" aria-label="Dia do mês" />
              </div>
              <button className="btn">Salvar</button>
            </form>
          </details>
        </div>

        <div className="card">
          <div className="eyebrow mb-1">Contas a pagar</div>
          {bills.length ? bills.map((b) => {
            const late = b.dueDate! < today;
            return (
              <div key={b.id} className="row">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{b.description}</div>
                  <div className="text-[13px] text-ink-3">{b.recurringItemId ? "Mensal · " : ""}{b.amountCents ? brl(b.amountCents) : "Valor a definir"}</div>
                </div>
                <span className={`pill ${late ? "pill-bad" : b.dueDate! <= today ? "pill-warn" : "pill-ok"}`}>{late ? "Vencida" : relDay(b.dueDate!, today) === "Hoje" ? "Hoje" : fmtShort(b.dueDate!)}</span>
                <SmallButton action={payBill.bind(null, b.id)}>Paguei</SmallButton>
              </div>
            );
          }) : <Empty>Nenhuma conta pendente. Diga “minha conta de luz vence todo dia 10”.</Empty>}
        </div>

        <div className="card">
          <div className="eyebrow mb-1">Por categoria</div>
          {cats.length ? cats.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 py-2">
              <span>{category(k).emoji} {category(k).name}</span>
              <span className="num font-semibold">{brl(v)}</span>
              <div className="col-span-2 h-2 overflow-hidden rounded-full bg-surface-2"><i className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (v / maxC) * 100)}%` }} /></div>
            </div>
          )) : <Empty>Sem despesas este mês. Diga “gastei 45 reais no almoço”.</Empty>}
        </div>

        {fam && (
          <div className="card">
            <div className="mb-1 flex items-baseline justify-between"><div className="eyebrow">👨‍👩‍👧 Gastos da casa</div><b className="num">{brl(fam.totalCents)}</b></div>
            {fam.expenses.length ? fam.expenses.slice(0, 15).map((e) => (
              <div key={e.id} className="row">
                <span className="text-xl">{category(e.categoryKey).emoji}</span>
                <div className="min-w-0 flex-1"><div className="font-medium">{e.description}</div><div className="text-[13px] text-ink-3">{relDay(e.date, today)} · {category(e.categoryKey).name}</div></div>
                <span className="num whitespace-nowrap font-semibold">− {brl(e.amountCents ?? 0)}</span>
              </div>
            )) : <Empty>Diga “gastei 300 no mercado da casa” para registrar um gasto da família.</Empty>}
          </div>
        )}

        <div className="card">
          <div className="eyebrow mb-2">Lançamentos do mês</div>
          {tx.length ? tx.map((t) => (
            <div key={t.kind + t.id} className="row">
              <span className="text-xl">{category(t.cat).emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium [overflow-wrap:anywhere]">{t.desc}</div>
                <div className="text-[13px] text-ink-3">{relDay(t.date, today)} · {category(t.cat).name}{t.method ? ` · ${METHOD_LABEL[t.method]}` : ""}{t.fixed ? " · 🔁 fixo" : ""}</div>
              </div>
              <span className={`num whitespace-nowrap font-semibold ${t.kind === "income" ? "text-good" : ""}`}>{t.kind === "income" ? "+" : "−"} {brl(t.cents)}</span>
              <XButton action={(t.kind === "income" ? deleteIncome : deleteExpense).bind(null, t.id)} label={`Apagar ${t.desc}`} />
            </div>
          )) : <Empty>Nada registrado ainda.</Empty>}
        </div>

        {subs.length > 0 && (
          <div className="card">
            <div className="eyebrow mb-2">🔄 Assinaturas</div>
            {subs.map((s) => (
              <div key={s.id} className="row"><div className="min-w-0 flex-1 font-medium">{s.name}</div><span className="num font-semibold">{brl(s.amountCents)}{s.cycle === "YEARLY" ? "/ano" : ""}</span></div>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
              <div><div className="text-ink-3">Total mensal</div><b className="num">{brl(Math.round(subsMonthly))}</b></div>
              <div><div className="text-ink-3">Total anual estimado</div><b className="num">{brl(Math.round(subsMonthly * 12))}</b></div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
