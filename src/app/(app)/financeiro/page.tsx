import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { MESES, relDay, todayIn, fmtShort } from "@/lib/dates";
import { brl, METHOD_LABEL } from "@/lib/money";
import { loadCategories } from "@/lib/data/user-categories";
import { addCategoryForm, deleteCategory } from "@/actions/categories";
import { payInvoiceAction } from "@/actions/cards";
import { unpaidInvoicesDue } from "@/lib/cards";
import { FinanceTabs } from "@/components/FinanceTabs";
import { convert, getRates, rate } from "@/lib/fx";
import { CURRENCIES, isCurrency, type Currency } from "@/lib/money";
import { fmtBR } from "@/lib/dates";
import { explainSimulation, monthBudget, simulate } from "@/lib/budget";
import { addDays } from "@/lib/dates";
import { hasFeature, PLANS, type PlanId } from "@/lib/plans";
import { activeSubscriptions, ensureRecurringBills, fixedItems, householdFinance, monthFinance, pendingBills } from "@/lib/data/queries";
import { addFixed, cancelFixed } from "@/actions/fixed";
import { deleteExpense, deleteIncome, payBill } from "@/actions/items";
import { Empty, PageHeader, SmallButton, XButton } from "@/components/ui";

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<{ valor?: string; parcelas?: string; cv?: string; de?: string; para?: string }> }) {
  const sp = await searchParams;
  const { user, access } = await requirePageAccess();
  if (!hasFeature(access.plan, "financeiro")) {
    return (
      <>
        <PageHeader title="Dinheiro" subtitle="Receitas, despesas e contas" />
        <div className="card flex flex-col gap-3">
          <p className="text-[17px]">Registre seus gastos só falando: “Gastei 45 reais no almoço”.</p>
          <p className="text-ink-2">O financeiro faz parte do plano Premium ({brl(PLANS.PREMIUM.priceCents, "BRL")}/mês), junto com memória, áudio e lembretes inteligentes.</p>
          <Link href="/config" className="btn w-fit">Ver planos</Link>
        </div>
      </>
    );
  }
  const db = getDb();
  const today = todayIn(user.timezone);
  await ensureRecurringBills(db, user.id, today, user.timezone);
  const [fin, bills, subs, fam, fixos, ucats] = await Promise.all([monthFinance(db, user.id, today), pendingBills(db, access), activeSubscriptions(db, user.id), householdFinance(db, access, today), fixedItems(db, user.id), loadCategories(db, user.id)]);
  const faturas = await unpaidInvoicesDue(db, user.id, today, addDays(today, 30));
  const budget = await monthBudget(db, user.id, today, user.timezone);
  const myCur: Currency = isCurrency(user.currency) ? user.currency : "BRL";
  const sym = CURRENCIES[myCur].symbol;
  // conversor de moedas
  const fx = await getRates(db, today);
  const cvValor = sp.cv ? Number(String(sp.cv).replace(/\./g, "").replace(",", ".")) : NaN;
  const cvDe: Currency = isCurrency(sp.de) ? sp.de : myCur === "BRL" ? "USD" : "BRL";
  const cvPara: Currency = isCurrency(sp.para) ? sp.para : myCur;
  const cvOut = fx && cvValor > 0 && cvValor < 1e9 ? convert(Math.round(cvValor * 100), cvDe, cvPara, fx) : null;
  const simValor = sp.valor ? Number(String(sp.valor).replace(/\./g, "").replace(",", ".")) : NaN;
  const simN = Math.min(48, Math.max(1, Number(sp.parcelas ?? 1) || 1));
  const sim = simValor > 0 && simValor < 10_000_000 ? { text: explainSimulation(budget, Math.round(simValor * 100), simN), r: simulate(budget, Math.round(simValor * 100), simN) } : null;
  const category = (k: string | null | undefined) => ucats.get(k);
  const myCats = ucats.list.filter((c) => c.custom || c.keywords.length);

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
      <FinanceTabs active="resumo" />
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
          {fin.cardCents > 0 && (
            <Link href="/financeiro/cartoes" className="mt-3 flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span>💳 Parcelas de cartão que vencem este mês</span><b className="num">{brl(fin.cardCents)}</b>
            </Link>
          )}
        </div>

        <div className="card" id="posso-gastar">
          <div className="eyebrow mb-1">💡 Posso gastar?</div>
          {budget.hasIncome ? (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className={`num font-display text-[30px] font-semibold leading-tight ${budget.marginCents < 0 ? "text-bad" : "text-good"}`}>{budget.marginCents < 0 ? brl(budget.marginCents) : brl(budget.freeCents)}</div>
                  <div className="text-[13px] text-ink-3">{budget.marginCents < 0 ? "no vermelho este mês" : `livres este mês · ~${brl(budget.perDayCents)}/dia nos próximos ${budget.daysLeft} dias`}</div>
                </div>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-[13px] font-semibold text-accent">Como calculei</summary>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                  <span>Já recebido</span><b className="num text-good">{brl(budget.receivedCents)}</b>
                  {budget.expectedIncomeCents > 0 && <><span>Receitas fixas que ainda vão cair</span><b className="num text-good">{brl(budget.expectedIncomeCents)}</b></>}
                  <span>Já gasto (inclui parcelas do mês)</span><b className="num">− {brl(budget.spentCents)}</b>
                  {budget.pendingBillsCents > 0 && <><span>Contas a pagar</span><b className="num">− {brl(budget.pendingBillsCents)}</b></>}
                  {budget.fixedToComeCents > 0 && <><span>Despesas fixas que ainda vão sair</span><b className="num">− {brl(budget.fixedToComeCents)}</b></>}
                  {budget.subscriptionsCents > 0 && <><span>Assinaturas</span><b className="num">− {brl(budget.subscriptionsCents)}</b></>}
                  <span className="border-t border-line pt-1 font-semibold">Margem do mês</span><b className="num border-t border-line pt-1">{brl(budget.marginCents)}</b>
                  <span className="text-ink-3">Folga para imprevistos (10% da renda)</span><b className="num text-ink-3">− {brl(budget.cushionCents)}</b>
                  <span className="text-ink-3">Mês que vem (previsto)</span><b className="num text-ink-3">{brl(budget.next.marginCents)}</b>
                </div>
              </details>
              <form className="mt-3 grid grid-cols-[1fr_6.5rem] gap-2 border-t border-line pt-3" action="/financeiro#posso-gastar">
                <input name="valor" required inputMode="decimal" pattern="[0-9.,]+" defaultValue={sp.valor ?? ""} placeholder={`Quero comprar algo de ${sym}…`} className="field" aria-label="Valor da compra" />
                <select name="parcelas" defaultValue={String(simN)} className="field" aria-label="Parcelas">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `${n}x`}</option>)}
                </select>
                <button className="btn col-span-2">Posso comprar?</button>
              </form>
              {sim && (
                <p className={`mt-3 rounded-xl px-3 py-2 text-[15px] ${sim.r.verdict === "ok" ? "bg-accent-soft" : sim.r.verdict === "apertado" ? "bg-warn-soft" : "bg-bad-soft"}`}>{sim.text}</p>
              )}
            </>
          ) : <Empty>Me conta sua renda e eu calculo quanto você pode gastar sem se apertar. Diga: “meu salário de 4.000 cai todo dia 5”.</Empty>}
        </div>

        <div className="card" id="conversor">
          <div className="eyebrow mb-2">💱 Conversor de moedas</div>
          {fx ? (
            <>
              <form action="/financeiro#conversor" className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <input name="cv" required inputMode="decimal" pattern="[0-9.,]+" defaultValue={sp.cv ?? ""} placeholder="Valor" className="field" aria-label="Valor" />
                <select name="de" defaultValue={cvDe} className="field" aria-label="De">
                  {Object.entries(CURRENCIES).map(([k, c]) => <option key={k} value={k}>{c.flag} {k}</option>)}
                </select>
                <select name="para" defaultValue={cvPara} className="field" aria-label="Para">
                  {Object.entries(CURRENCIES).map(([k, c]) => <option key={k} value={k}>→ {c.flag} {k}</option>)}
                </select>
                <button className="btn col-span-3">Converter</button>
              </form>
              {cvOut !== null && (
                <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-[15px]">
                  <b className="num">{brl(Math.round(cvValor * 100), cvDe)}</b> = <b className="num">{brl(cvOut, cvPara)}</b>
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-3">
                {(["USD", "EUR", "BRL"] as Currency[]).filter((c) => c !== myCur).map((c) => (
                  <span key={c}>1 {CURRENCIES[c].symbol} = <b className="num">{brl(Math.round(rate(c, myCur, fx) * 100), myCur)}</b></span>
                ))}
                <span>· cotação de {fmtBR(fx.day)}</span>
              </div>
            </>
          ) : <Empty>Não consegui buscar a cotação agora. Tente de novo mais tarde.</Empty>}
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
                <input name="amount" required inputMode="decimal" pattern="[0-9.,]+" placeholder={`Valor (${sym})`} className="field" aria-label="Valor" />
                <input name="day" required type="number" min={1} max={31} inputMode="numeric" placeholder="Todo dia…" className="field" aria-label="Dia do mês" />
              </div>
              <button className="btn">Salvar</button>
            </form>
          </details>
        </div>

        <div className="card">
          <div className="eyebrow mb-1">Contas a pagar</div>
          {faturas.map((f) => (
            <div key={f.cardId + f.dueDate} className="row">
              <div className="min-w-0 flex-1">
                <div className="font-medium">💳 Fatura {f.cardName}</div>
                <div className="text-[13px] text-ink-3">{brl(f.totalCents)}</div>
              </div>
              <span className={`pill ${f.dueDate < today ? "pill-bad" : f.dueDate <= today ? "pill-warn" : "pill-ok"}`}>{f.dueDate < today ? "Vencida" : f.dueDate === today ? "Hoje" : fmtShort(f.dueDate)}</span>
              <SmallButton action={payInvoiceAction.bind(null, f.cardId, f.dueDate)}>Paguei</SmallButton>
            </div>
          ))}
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
          }) : faturas.length ? null : <Empty>Nenhuma conta pendente. Diga “minha conta de luz vence todo dia 10”.</Empty>}
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

        <div className="card">
          <div className="eyebrow mb-1">🏷️ Minhas categorias</div>
          {myCats.length ? myCats.map((c) => (
            <div key={c.key} className="row">
              <span className="text-xl">{c.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.name}{c.kind === "INCOME" ? <span className="ml-2 text-[12px] font-semibold text-good">receita</span> : null}</div>
                <div className="text-[13px] text-ink-3 [overflow-wrap:anywhere]">{c.keywords.length ? `Entra aqui: ${c.keywords.join(", ")}` : "Sem palavras-chave"}</div>
              </div>
              {c.custom && <XButton action={deleteCategory.bind(null, c.name)} label={`Apagar categoria ${c.name}`} />}
            </div>
          )) : <Empty>Crie as suas falando com a Nina: “barbearia vai na categoria Beleza” ou “cria a categoria Pet com ração e veterinário”.</Empty>}
          <details className="mt-2 border-t border-line pt-2">
            <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">+ Nova categoria</summary>
            <form action={addCategoryForm} className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-[4.5rem_1fr] gap-2">
                <input name="emoji" maxLength={8} placeholder="🏷️" className="field text-center" aria-label="Emoji" />
                <input name="name" required maxLength={40} placeholder="Nome (ex.: Beleza)" className="field" aria-label="Nome da categoria" />
              </div>
              <input name="keywords" maxLength={400} placeholder="O que entra nela (ex.: barbearia, manicure)" className="field" aria-label="Palavras-chave" />
              <select name="kind" className="field" defaultValue="expense" aria-label="Tipo">
                <option value="expense">Categoria de despesa</option>
                <option value="income">Categoria de receita</option>
              </select>
              <button className="btn">Salvar</button>
              <p className="text-[13px] text-ink-3">Os lançamentos antigos com essas palavras mudam de categoria na hora.</p>
            </form>
          </details>
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
