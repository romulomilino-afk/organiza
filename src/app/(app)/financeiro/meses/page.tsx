import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { hasFeature, PLANS } from "@/lib/plans";
import { brl } from "@/lib/money";
import { fmtBR, todayIn } from "@/lib/dates";
import { monthFinance } from "@/lib/data/queries";
import { loadCategories } from "@/lib/data/user-categories";
import { isMonthKey, monthKey, monthLabel, monthShort, monthsWithData, monthSummary, reserveBalance } from "@/lib/months";
import { FinanceTabs } from "@/components/FinanceTabs";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const short = (c: number) => brl(c).replace(/,00$/, "");
const pct = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100));

function Delta({ now, before, goodWhenUp }: { now: number; before: number; goodWhenUp: boolean }) {
  const p = pct(now, before);
  if (p === null || p === 0) return null;
  const up = p > 0;
  const good = up === goodWhenUp;
  return <span className={`ml-1 whitespace-nowrap text-[12px] font-semibold ${good ? "text-good" : "text-bad"}`}>{up ? "▲" : "▼"} {Math.abs(p)}%</span>;
}

export default async function MesesPage({ searchParams }: { searchParams: Promise<{ m?: string | string[]; ver?: string }> }) {
  const sp = await searchParams;
  const { user, access } = await requirePageAccess();
  if (!hasFeature(access.plan, "financeiro")) {
    return (
      <>
        <PageHeader title="Dinheiro" subtitle="Comparar meses" />
        <div className="card flex flex-col gap-3">
          <p className="text-ink-2">Comparar meses e guardar na reserva fazem parte do plano Premium ({brl(PLANS.PREMIUM.priceCents, "BRL")}/mês).</p>
          <Link href="/planos" className="btn w-fit">Ver planos</Link>
        </div>
      </>
    );
  }
  const db = getDb();
  const today = todayIn(user.timezone);
  const available = await monthsWithData(db, user.id, today, 24);
  const asked = (Array.isArray(sp.m) ? sp.m : sp.m ? sp.m.split(",") : []).filter(isMonthKey).filter((m) => available.includes(m));
  const selected = [...new Set(asked.length ? asked : available.slice(0, 3))].sort().slice(-6); // cronológico, no máximo 6
  const [sums, ucats, reserve] = await Promise.all([Promise.all(selected.map((m) => monthSummary(db, user.id, m))), loadCategories(db, user.id), reserveBalance(db, user.id)]);
  const maxV = Math.max(1, ...sums.flatMap((s) => [s.incomeCents, s.expenseCents]));
  const last = sums[sums.length - 1], prev = sums[sums.length - 2];

  // categorias: todas que aparecem nos meses escolhidos, da maior para a menor (soma)
  const catTotals = new Map<string, number>();
  for (const s of sums) for (const [k, v] of Object.entries(s.byCategory)) catTotals.set(k, (catTotals.get(k) ?? 0) + v);
  const catRows = [...catTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const ver = isMonthKey(sp.ver) ? sp.ver : null;
  const detail = ver ? await monthFinance(db, user.id, `${ver}-15`) : null;
  const detailTx = detail ? [
    ...detail.expenses.map((e) => ({ id: e.id, inc: false, date: e.date, cents: e.amountCents ?? 0, desc: e.description, cat: e.categoryKey })),
    ...detail.incomes.map((i) => ({ id: i.id, inc: true, date: i.date, cents: i.amountCents, desc: i.description, cat: i.categoryKey })),
  ].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const qs = (extra: Record<string, string>) => new URLSearchParams({ m: selected.join(","), ...extra }).toString();

  return (
    <>
      <PageHeader title="Dinheiro" subtitle="Comparar meses" />
      <FinanceTabs active="meses" />
      <div className="flex flex-col gap-3">
        <form className="card flex flex-col gap-3" action="/financeiro/meses">
          <div className="eyebrow">Escolha os meses (até 6)</div>
          <div className="flex flex-wrap gap-2">
            {available.map((m) => (
              <label key={m} className="cursor-pointer">
                <input type="checkbox" name="m" value={m} defaultChecked={selected.includes(m)} className="peer sr-only" />
                <span className="inline-block rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2">
                  {monthShort(m)}{m === monthKey(today) ? " · atual" : ""}
                </span>
              </label>
            ))}
          </div>
          <button className="btn w-fit">Comparar</button>
        </form>

        {last && prev && (
          <div className="card text-[15px]">
            <div className="eyebrow mb-1">Resumo</div>
            Em <b>{monthLabel(last.month)}</b> você gastou <b className="num">{brl(Math.abs(last.expenseCents - prev.expenseCents))}</b> {last.expenseCents >= prev.expenseCents ? "a mais" : "a menos"} que em <b>{monthLabel(prev.month)}</b>
            {" "}e recebeu <b className="num">{brl(Math.abs(last.incomeCents - prev.incomeCents))}</b> {last.incomeCents >= prev.incomeCents ? "a mais" : "a menos"}.
            {last.month === monthKey(today) && <span className="text-ink-3"> ({monthLabel(last.month)} ainda não terminou.)</span>}
          </div>
        )}

        <div className="card flex flex-col gap-4">
          <div className="eyebrow">Receitas × despesas</div>
          {sums.map((s, i) => (
            <div key={s.month} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <b>{cap(monthLabel(s.month, true))}</b>
                <Link href={`/financeiro/meses?${qs({ ver: s.month })}#lancamentos`} className="text-[13px] font-semibold text-accent">Ver lançamentos</Link>
              </div>
              <div className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
                <span className="text-ink-3">Receitas</span>
                <div className="h-3 overflow-hidden rounded-full bg-surface-2"><i className="block h-full rounded-full bg-good" style={{ width: `${Math.max(2, (s.incomeCents / maxV) * 100)}%` }} /></div>
                <span className="num text-right font-semibold">{brl(s.incomeCents)}{i > 0 && <Delta now={s.incomeCents} before={sums[i - 1].incomeCents} goodWhenUp />}</span>
                <span className="text-ink-3">Despesas</span>
                <div className="h-3 overflow-hidden rounded-full bg-surface-2"><i className="block h-full rounded-full bg-bad" style={{ width: `${Math.max(2, (s.expenseCents / maxV) * 100)}%` }} /></div>
                <span className="num text-right font-semibold">{brl(s.expenseCents)}{i > 0 && <Delta now={s.expenseCents} before={sums[i - 1].expenseCents} goodWhenUp={false} />}</span>
              </div>
              <div className="flex justify-between border-b border-line pb-3 text-sm"><span className="text-ink-3">Resultado</span><b className={`num ${s.resultCents < 0 ? "text-bad" : "text-good"}`}>{brl(s.resultCents)}</b></div>
            </div>
          ))}
          <div className="flex justify-between text-sm"><span>🐷 Na reserva hoje</span><b className="num text-good">{brl(reserve)}</b></div>
        </div>

        {catRows.length > 0 && (
          <div className="card">
            <div className="eyebrow mb-2">Gastos por categoria</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="py-1 pr-2 font-semibold">Categoria</th>
                    {sums.map((s) => <th key={s.month} className="whitespace-nowrap px-1 py-1 text-right font-semibold">{cap(monthShort(s.month))}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {catRows.map((k) => (
                    <tr key={k} className="border-t border-line">
                      <td className="whitespace-nowrap py-2 pr-2">{ucats.get(k).emoji} {ucats.get(k).name}</td>
                      {sums.map((s, i) => {
                        const v = s.byCategory[k] ?? 0;
                        const b = i > 0 ? sums[i - 1].byCategory[k] ?? 0 : null;
                        return (
                          <td key={s.month} className="num whitespace-nowrap px-1 py-2 text-right align-top">
                            <div>{v ? short(v) : <span className="text-ink-3">—</span>}</div>
                            {b !== null && v > 0 && b > 0 && <div className="-mt-0.5"><Delta now={v} before={b} goodWhenUp={false} /></div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-ink-3">▲▼ comparam com o mês anterior da lista. Nas despesas, verde é gastar menos.</p>
          </div>
        )}

        {detail && ver && (
          <div className="card" id="lancamentos">
            <div className="mb-1 flex items-baseline justify-between">
              <div className="eyebrow">Lançamentos de {monthLabel(ver, true)}</div>
              <Link href={`/financeiro/meses?${qs({})}`} className="text-[13px] font-semibold text-ink-3">Fechar</Link>
            </div>
            {detailTx.length ? detailTx.map((t) => (
              <div key={t.id} className="row">
                <span className="text-xl">{t.inc ? "💵" : ucats.get(t.cat).emoji}</span>
                <div className="min-w-0 flex-1"><div className="font-medium">{t.desc}</div><div className="text-[13px] text-ink-3">{fmtBR(t.date).slice(0, 5)} · {t.inc ? "Receita" : ucats.get(t.cat).name}</div></div>
                <b className={`num ${t.inc ? "text-good" : ""}`}>{t.inc ? "+ " : ""}{brl(t.cents)}</b>
              </div>
            )) : <p className="text-sm text-ink-3">Nenhum lançamento neste mês.</p>}
            {detail.cardCents > 0 && <p className="mt-2 text-[13px] text-ink-3">Inclui {brl(detail.cardCents)} em parcelas de cartão que venceram no mês (veja em Cartões).</p>}
          </div>
        )}
      </div>
    </>
  );
}
