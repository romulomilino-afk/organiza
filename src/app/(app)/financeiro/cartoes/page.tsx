import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { MESES, fmtBR, fmtShort, todayIn } from "@/lib/dates";
import { brl } from "@/lib/money";
import { hasFeature } from "@/lib/plans";
import { cardsOverview, firstDueDate, type Invoice } from "@/lib/cards";
import { loadCategories } from "@/lib/data/user-categories";
import { addCardForm, addPurchaseForm, cancelPurchaseAction, deleteCardAction, payInvoiceAction } from "@/actions/cards";
import { Empty, PageHeader, SmallButton, XButton } from "@/components/ui";
import { FinanceTabs } from "@/components/FinanceTabs";

const mesAno = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1].slice(0, 3)}/${d.slice(2, 4)}`;
const STATUS: Record<Invoice["status"], { label: string; cls: string }> = {
  aberta: { label: "Aberta", cls: "pill-ok" },
  fechada: { label: "Fechada", cls: "pill-warn" },
  vencida: { label: "Vencida", cls: "pill-bad" },
  paga: { label: "Paga", cls: "pill-ok" },
};

export default async function CartoesPage() {
  const { user, access } = await requirePageAccess();
  if (!hasFeature(access.plan, "financeiro")) {
    return (
      <>
        <PageHeader title="Dinheiro" subtitle="Cartões de crédito" />
        <div className="card flex flex-col gap-3">
          <p className="text-[17px]">Controle faturas e parcelas só falando: “comprei uma TV de 3.000 em 10x no Nubank”.</p>
          <p className="text-ink-2">Os cartões fazem parte do plano Premium (R$ 14,90/mês).</p>
          <Link href="/planos" className="btn w-fit">Ver planos</Link>
        </div>
      </>
    );
  }
  const db = getDb();
  const today = todayIn(user.timezone);
  const [cards, cats] = await Promise.all([cardsOverview(db, user.id, today), loadCategories(db, user.id)]);

  const InvoiceItems = ({ inv }: { inv: Invoice }) => (
    <details className="mt-1">
      <summary className="cursor-pointer text-[13px] font-semibold text-accent">Ver {inv.items.length} {inv.items.length === 1 ? "item" : "itens"}</summary>
      <div className="mt-1">
        {inv.items.map((it) => (
          <div key={it.purchaseId + it.number} className="flex items-baseline gap-2 py-1 text-sm">
            <span>{cats.get(it.categoryKey).emoji}</span>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{it.description}{it.of > 1 ? <span className="text-ink-3"> · {it.number}/{it.of}</span> : null}</span>
            <span className="num font-semibold">{brl(it.amountCents)}</span>
          </div>
        ))}
      </div>
    </details>
  );

  return (
    <>
      <PageHeader title="Dinheiro" subtitle="Cartões de crédito" />
      <FinanceTabs active="cartoes" />
      <div className="flex flex-col gap-3">
        {cards.length === 0 && (
          <div className="card">
            <p className="text-[17px] font-semibold">Cadastre seu cartão</p>
            <p className="mt-1 text-ink-2">Diga para a Nina: “meu Nubank fecha dia 3 e vence dia 10”. Depois é só falar as compras: “comprei um tênis de 400 em 4x no Nubank”.</p>
            <p className="mt-2 text-sm text-ink-3">Eu calculo em qual fatura cada parcela cai, quanto vem em cada mês e o melhor dia para comprar.</p>
          </div>
        )}

        {cards.map(({ card, best, toPay, open, upcoming, usedCents, purchases }) => {
          const pct = card.limitCents ? Math.min(100, Math.round((usedCents / card.limitCents) * 100)) : null;
          const next = upcoming.filter((i) => i.dueDate > (open?.dueDate ?? toPay?.dueDate ?? today));
          const maxNext = Math.max(...next.map((i) => i.totalCents), 1);
          return (
            <section key={card.id} className="flex flex-col gap-3">
              {/* o "cartão" */}
              <div className="rounded-3xl bg-accent p-5 text-accent-ink shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold opacity-80">💳 Cartão de crédito</div>
                    <div className="font-display text-[26px] font-bold leading-tight">{card.name}</div>
                  </div>
                  <div className="text-right text-[13px] opacity-90">Fecha dia <b>{card.closingDay}</b><br />Vence dia <b>{card.dueDay}</b></div>
                </div>
                {pct !== null && (
                  <div className="mt-4">
                    <div className="flex justify-between text-[13px] opacity-90"><span>Limite usado</span><span className="num">{brl(usedCents)} de {brl(card.limitCents!)}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/25"><i className="block h-full rounded-full bg-white" style={{ width: `${Math.max(2, pct)}%` }} /></div>
                    <div className="mt-1 text-[13px] opacity-90">Disponível: <b className="num">{brl(Math.max(0, card.limitCents! - usedCents))}</b></div>
                  </div>
                )}
                <div className="mt-4 rounded-2xl bg-white/15 px-3 py-2 text-sm">
                  {best.goodNow
                    ? <>✨ <b>Hoje é um bom dia para comprar.</b> A fatura já fechou: o que você comprar agora só vence em {fmtBR(firstDueDate(today, card.closingDay, card.dueDay))}.</>
                    : <>📅 <b>Melhor dia de compra: dia {best.day}.</b> Próximo: {fmtBR(best.nextClose)}.</>}
                </div>
              </div>

              {toPay && (
                <div className="card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="eyebrow">Fatura a pagar</div>
                    <span className={`pill ${STATUS[toPay.status].cls}`}>{STATUS[toPay.status].label}</span>
                  </div>
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <div>
                      <div className="num font-display text-[28px] font-semibold">{brl(toPay.totalCents)}</div>
                      <div className="text-[13px] text-ink-3">Vence {fmtBR(toPay.dueDate)}</div>
                    </div>
                    <SmallButton action={payInvoiceAction.bind(null, card.id, toPay.dueDate)}>Paguei</SmallButton>
                  </div>
                  <InvoiceItems inv={toPay} />
                </div>
              )}

              <div className="card">
                <div className="flex items-center justify-between gap-2">
                  <div className="eyebrow">Fatura aberta</div>
                  {open && <span className="text-[13px] text-ink-3">fecha {fmtShort(open.closingDate)} · vence {fmtShort(open.dueDate)}</span>}
                </div>
                {open ? (
                  <>
                    <div className="num mt-1 font-display text-[24px] font-semibold">{brl(open.totalCents)}</div>
                    <InvoiceItems inv={open} />
                  </>
                ) : <Empty>Nada na fatura aberta ainda.</Empty>}
              </div>

              {next.length > 0 && (
                <div className="card">
                  <div className="eyebrow mb-1">Próximas faturas</div>
                  {next.map((i) => (
                    <div key={i.dueDate} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-1.5">
                      <span className="text-sm font-semibold">{mesAno(i.dueDate)}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2"><i className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(3, (i.totalCents / maxNext) * 100)}%` }} /></div>
                      <span className="num text-sm font-semibold">{brl(i.totalCents)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="card">
                <div className="eyebrow mb-1">Parcelas em andamento</div>
                {purchases.filter((p) => p.of > 1).length ? purchases.filter((p) => p.of > 1).map((p) => (
                  <div key={p.purchaseId} className="row">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium [overflow-wrap:anywhere]">{p.description}</div>
                      <div className="text-[13px] text-ink-3">Parcela {p.next}/{p.of} · {brl(p.amountCents)}/mês · termina em {mesAno(p.lastDue)}</div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><i className="block h-full rounded-full bg-accent" style={{ width: `${((p.of - p.remaining) / p.of) * 100}%` }} /></div>
                    </div>
                    <div className="text-right">
                      <div className="num whitespace-nowrap text-sm font-semibold">{brl(p.remainingCents)}</div>
                      <div className="text-[12px] text-ink-3">faltam {p.remaining}</div>
                    </div>
                    <XButton action={cancelPurchaseAction.bind(null, p.purchaseId)} label={`Cancelar compra ${p.description}`} />
                  </div>
                )) : <Empty>Nenhuma compra parcelada. Diga “comprei uma TV de 3.000 em 10x no {card.name}”.</Empty>}
              </div>

              <details className="card">
                <summary className="cursor-pointer text-sm font-semibold text-accent">✏️ Editar {card.name} (limite, fechamento, vencimento)</summary>
                <form action={addCardForm} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="name" value={card.name} />
                  <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Limite
                    <input name="limit" inputMode="decimal" pattern="[0-9.,]*" defaultValue={card.limitCents ? String(card.limitCents / 100).replace(".", ",") : ""} placeholder="Ex.: 5.000" className="field font-normal" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Fecha dia
                      <input name="closingDay" required type="number" min={1} max={31} defaultValue={card.closingDay} className="field font-normal" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Vence dia
                      <input name="dueDay" required type="number" min={1} max={31} defaultValue={card.dueDay} className="field font-normal" />
                    </label>
                  </div>
                  <button className="btn">Salvar alterações</button>
                </form>
                <form action={deleteCardAction.bind(null, card.name)} className="mt-3 border-t border-line pt-3 text-right">
                  <button className="text-[13px] text-bad underline">Remover cartão {card.name}</button>
                </form>
              </details>
            </section>
          );
        })}

        {cards.length > 0 && (
          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold text-accent">+ Nova compra no cartão</summary>
            <form action={addPurchaseForm} className="mt-3 flex flex-col gap-2">
              <select name="cardId" className="field" aria-label="Cartão">
                {cards.map(({ card }) => <option key={card.id} value={card.id}>{card.name}</option>)}
              </select>
              <input name="description" required maxLength={120} placeholder="O que comprou (ex.: TV, Mercado)" className="field" aria-label="Descrição" />
              <div className="grid grid-cols-2 gap-2">
                <input name="amount" required inputMode="decimal" pattern="[0-9.,]+" placeholder="Valor total (R$)" className="field" aria-label="Valor total" />
                <select name="installments" className="field" defaultValue="1" aria-label="Parcelas">
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "À vista" : `${n}x`}</option>)}
                </select>
              </div>
              <input name="date" type="date" max={today} defaultValue={today} className="field" aria-label="Data da compra" />
              <button className="btn">Lançar compra</button>
            </form>
          </details>
        )}

        <details className="card" open={cards.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-accent">+ Novo cartão</summary>
          <form action={addCardForm} className="mt-3 flex flex-col gap-2">
            <input name="name" required maxLength={40} placeholder="Nome (ex.: Nubank, Inter)" className="field" aria-label="Nome do cartão" />
            <div className="grid grid-cols-2 gap-2">
              <input name="closingDay" required type="number" min={1} max={31} inputMode="numeric" placeholder="Fecha dia…" className="field" aria-label="Dia de fechamento" />
              <input name="dueDay" required type="number" min={1} max={31} inputMode="numeric" placeholder="Vence dia…" className="field" aria-label="Dia de vencimento" />
            </div>
            <input name="limit" inputMode="decimal" pattern="[0-9.,]*" placeholder="Limite (opcional)" className="field" aria-label="Limite" />
            <p className="text-[13px] text-ink-3">O fechamento aparece na fatura ou no app do banco (geralmente uns 7 dias antes do vencimento).</p>
            <button className="btn">Salvar cartão</button>
          </form>
        </details>
      </div>
    </>
  );
}
