import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { fmtBR, fmtShort, todayIn } from "@/lib/dates";
import { brl, CURRENCIES, currentCurrency } from "@/lib/money";
import { hasFeature, PLANS } from "@/lib/plans";
import { benefitsOverview, ensureBenefitCredits } from "@/lib/benefits";
import { loadCategories } from "@/lib/data/user-categories";
import { addBenefitForm, addBenefitSpendForm, deleteBenefitAction, deleteBenefitEntryAction, updateBenefitForm } from "@/actions/benefits";
import { Empty, PageHeader, XButton } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";

export const dynamic = "force-dynamic";

export default async function ValesPage() {
  const { user, access } = await requirePageAccess();
  if (!hasFeature(access.plan, "financeiro")) {
    return (
      <>
        <PageHeader title="Dinheiro" subtitle="Vale-alimentação e refeição" />
        <div className="card flex flex-col gap-3">
          <p className="text-[17px]">Controle o saldo do seu vale só falando: “gastei 45 no almoço com o VR”.</p>
          <p className="text-ink-2">Os vales fazem parte do plano Premium ({brl(PLANS.PREMIUM.priceCents, "BRL")}/mês).</p>
          <Link href="/planos" className="btn w-fit">Ver planos</Link>
        </div>
      </>
    );
  }
  const db = getDb();
  const today = todayIn(user.timezone);
  await ensureBenefitCredits(db, user.id, today, user.timezone);
  const [vales, cats] = await Promise.all([benefitsOverview(db, user.id, today), loadCategories(db, user.id)]);
  const expenseCats = cats.expense();
  const sym = CURRENCIES[currentCurrency()].symbol;

  return (
    <>
      <PageHeader title="Dinheiro" subtitle="Vale-alimentação e refeição" />
      <FinanceTabs active="vales" />
      <div className="flex flex-col gap-3">
        {vales.length === 0 && (
          <div className="card">
            <p className="text-[17px] font-semibold">Cadastre o vale da sua empresa</p>
            <p className="mt-1 text-ink-2">Diga para a Nina: “meu vale-refeição é de 800 e cai todo dia 1”. Depois é só falar: “gastei 45 no almoço com o VR”.</p>
            <p className="mt-2 text-sm text-ink-3">O crédito do mês entra no saldo do vale e os gastos saem dele. Nada disso mexe na sua receita, nas despesas do mês nem no “Posso gastar?”.</p>
          </div>
        )}

        {vales.map(({ card, kind, balanceCents, spentCents, nextCredit, daysToNext, perDayCents, entries }) => (
          <section key={card.id} className="flex flex-col gap-3">
            <div className="rounded-3xl p-5 shadow-sm" style={{ background: "linear-gradient(135deg,#F2C75C 0%,#E9A93C 100%)", color: "#2B2108" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold opacity-80">{kind.emoji} {kind.label}</div>
                  <div className="font-display text-[24px] font-bold leading-tight">{card.name}</div>
                </div>
                <div className="text-right text-[13px] opacity-90">Recebe <b>{brl(card.monthlyCents)}</b><br />todo dia <b>{card.creditDay}</b></div>
              </div>
              <div className="mt-4 text-[13px] font-semibold opacity-80">Saldo</div>
              <div className={`num font-display text-[36px] font-bold leading-none ${balanceCents < 0 ? "text-bad" : ""}`}>{brl(balanceCents)}</div>
              <div className="mt-4 rounded-2xl bg-white/40 px-3 py-2 text-sm">
                {balanceCents > 0
                  ? <>🍴 Dá uns <b className="num">{brl(perDayCents)}</b> por dia até o próximo crédito, em <b>{fmtBR(nextCredit)}</b> ({daysToNext} {daysToNext === 1 ? "dia" : "dias"}).</>
                  : <>O saldo acabou. O próximo crédito cai em <b>{fmtBR(nextCredit)}</b>.</>}
              </div>
            </div>

            <div className="card">
              <div className="flex items-center justify-between gap-2">
                <div className="eyebrow">Movimentos do mês</div>
                <span className="text-[13px] text-ink-3">gasto: <b className="num text-ink">{brl(spentCents)}</b></span>
              </div>
              {entries.length ? entries.map((e) => {
                const out = e.kind === "GASTO";
                const c = out ? cats.get(e.categoryKey) : null;
                return (
                  <div key={e.id} className="row">
                    <span className="text-xl">{out ? c!.emoji : e.kind === "CREDITO" ? "💰" : "✏️"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium [overflow-wrap:anywhere]">{e.description}</div>
                      <div className="text-[13px] text-ink-3">{fmtShort(e.date)}{c ? ` · ${c.name}` : ""}</div>
                    </div>
                    <span className={`num whitespace-nowrap font-semibold ${out ? "" : e.amountCents >= 0 ? "text-good" : "text-bad"}`}>{out ? "− " : e.amountCents >= 0 ? "+ " : "− "}{brl(Math.abs(e.amountCents))}</span>
                    <XButton action={deleteBenefitEntryAction.bind(null, e.id)} label={`Apagar ${e.description}`} />
                  </div>
                );
              }) : <Empty>Nada neste mês ainda. Diga “gastei 32 no almoço com o {card.name}”.</Empty>}
              <p className="mt-2 text-[12px] text-ink-3">Esses valores ficam só no vale: não entram nas despesas do mês nem no “Posso gastar?”.</p>
            </div>

            <details className="card">
              <summary className="cursor-pointer text-sm font-semibold text-accent">+ Gasto no {card.name}</summary>
              <form action={addBenefitSpendForm} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="cardId" value={card.id} />
                <input name="description" required maxLength={120} placeholder="O que foi (ex.: Almoço, Mercado)" className="field" aria-label="Descrição" />
                <div className="grid grid-cols-2 gap-2">
                  <input name="amount" required inputMode="decimal" pattern="[0-9.,]+" placeholder={`Valor (${sym})`} className="field" aria-label="Valor" />
                  <input name="date" type="date" max={today} defaultValue={today} className="field" aria-label="Data" />
                </div>
                <select name="category" defaultValue={card.kind === "OUTRO" ? "" : "alimentacao"} className="field" aria-label="Categoria">
                  <option value="">🪄 Categoria automática</option>
                  {expenseCats.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.name}</option>)}
                </select>
                <button className="btn">Tirar do saldo</button>
              </form>
            </details>

            <details className="card">
              <summary className="cursor-pointer text-sm font-semibold text-accent">✏️ Editar {card.name} (valor, dia, saldo)</summary>
              <form action={updateBenefitForm} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="cardId" value={card.id} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Crédito por mês
                    <input name="monthly" required inputMode="decimal" pattern="[0-9.,]+" defaultValue={(card.monthlyCents / 100).toFixed(2).replace(".", ",")} className="field font-normal" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Cai todo dia
                    <input name="day" required type="number" min={1} max={31} defaultValue={card.creditDay} className="field font-normal" />
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Saldo de hoje (opcional, corrige o saldo)
                  <input name="balance" inputMode="decimal" pattern="[0-9.,]*" placeholder={`Ex.: ${(Math.max(0, balanceCents) / 100).toFixed(2).replace(".", ",")}`} className="field font-normal" />
                </label>
                <button className="btn">Salvar alterações</button>
              </form>
              <form action={deleteBenefitAction.bind(null, card.id)} className="mt-3 border-t border-line pt-3 text-right">
                <button className="text-[13px] text-bad underline">Remover {card.name}</button>
              </form>
            </details>
          </section>
        ))}

        <details className="card" open={vales.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-accent">+ Novo vale</summary>
          <form action={addBenefitForm} className="mt-3 flex flex-col gap-2">
            <select name="kind" className="field" aria-label="Tipo" defaultValue="refeicao">
              <option value="refeicao">🍴 Vale-refeição</option>
              <option value="alimentacao">🛒 Vale-alimentação</option>
              <option value="outro">🎁 Outro benefício</option>
            </select>
            <input name="name" maxLength={40} placeholder="Nome (opcional, ex.: Alelo, VR, Pluxee)" className="field" aria-label="Nome" />
            <div className="grid grid-cols-2 gap-2">
              <input name="monthly" inputMode="decimal" pattern="[0-9.,]*" placeholder={`Crédito por mês (${sym})`} className="field" aria-label="Crédito por mês" />
              <input name="day" required type="number" min={1} max={31} inputMode="numeric" placeholder="Cai todo dia…" className="field" aria-label="Dia do crédito" />
            </div>
            <input name="balance" inputMode="decimal" pattern="[0-9.,]*" placeholder={`Saldo de hoje (${sym}, opcional)`} className="field" aria-label="Saldo de hoje" />
            <p className="text-[13px] text-ink-3">Todo mês, no dia do crédito, o valor entra no saldo do vale. O que sobra do mês continua no saldo.</p>
            <button className="btn">Salvar vale</button>
          </form>
        </details>
      </div>
    </>
  );
}
