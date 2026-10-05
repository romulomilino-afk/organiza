import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { addDays, diffDays, fmtBR, todayIn } from "@/lib/dates";
import { hasFeature } from "@/lib/plans";
import { activeRoutines, ensureRoutines, openDeadlines, remindFrom } from "@/lib/watch";
import { expiringItems } from "@/lib/data/queries";
import { addDeadlineForm, addRoutineForm, cancelRoutineAction, completeDeadlineAction, deleteDeadlineAction } from "@/actions/watch";
import { Empty, PageHeader, SmallButton, XButton } from "@/components/ui";

const quando = (n: number) => n < 0 ? `venceu há ${-n} dia${n === -1 ? "" : "s"}` : n === 0 ? "vence hoje" : n === 1 ? "vence amanhã" : `em ${n} dias`;
const dot = (n: number, window: number) => n <= 0 ? "🔴" : n <= 7 ? "🟡" : n <= window ? "🟢" : "⚪";

export default async function PendenciasPage() {
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const today = todayIn(user.timezone);
  await ensureRoutines(db, access, today);
  const [dls, routines, exp] = await Promise.all([openDeadlines(db, user.id), activeRoutines(db, access), expiringItems(db, user.id, addDays(today, 90))]);
  const showWar = hasFeature(access.plan, "garantias");

  return (
    <>
      <PageHeader title="Não deixe nada passar" subtitle="Vencimentos, renovações, garantias e compras de rotina" />
      <div className="flex flex-col gap-3">
        <div className="card bg-accent-soft">
          <p className="text-[15px]">Fale com a Nina do jeito que vier:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-2">
            <li>“Meu seguro vence em dezembro.”</li>
            <li>“Comprei uma TV hoje, a garantia é de 12 meses.”</li>
            <li>“Preciso comprar ração quando estiver acabando.”</li>
            <li>“A geladeira está fazendo um barulho estranho.”</li>
          </ul>
          <Link href="/nina" className="btn mt-3 inline-block">🎙️ Falar com a Nina</Link>
        </div>

        <div className="card">
          <div className="eyebrow mb-1">📌 Vencimentos e renovações</div>
          {dls.length ? dls.map((d) => {
            const n = diffDays(today, d.dueDate);
            return (
              <div key={d.id} className="row">
                <span className="text-lg">{dot(n, d.remindDaysBefore)}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium [overflow-wrap:anywhere]">{d.name}</div>
                  <div className="text-[13px] text-ink-3">{fmtBR(d.dueDate)} · {quando(n)}{d.renewMonths ? ` · renova a cada ${d.renewMonths === 12 ? "ano" : `${d.renewMonths} meses`}` : ""}</div>
                  {n > d.remindDaysBefore && <div className="text-[12px] text-ink-3">Aviso a partir de {fmtBR(remindFrom(d))}</div>}
                </div>
                <SmallButton action={completeDeadlineAction.bind(null, d.id)}>{d.renewMonths ? "Renovei" : "Resolvido"}</SmallButton>
                <XButton action={deleteDeadlineAction.bind(null, d.id)} label={`Apagar ${d.name}`} />
              </div>
            );
          }) : <Empty>Nada cadastrado. Diga “meu seguro vence em dezembro” ou “a CNH vence em março de 2028”.</Empty>}
          <details className="mt-2 border-t border-line pt-2">
            <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">+ Novo vencimento</summary>
            <form action={addDeadlineForm} className="mt-2 flex flex-col gap-2">
              <input name="name" required maxLength={80} placeholder="O quê? (ex.: Seguro do carro)" className="field" aria-label="Nome" />
              <div className="grid grid-cols-2 gap-2">
                <input name="date" type="date" required min={today} className="field" aria-label="Vencimento" />
                <select name="remind" defaultValue="30" className="field" aria-label="Avisar antes">
                  <option value="7">Avisar 7 dias antes</option>
                  <option value="15">Avisar 15 dias antes</option>
                  <option value="30">Avisar 30 dias antes</option>
                  <option value="60">Avisar 60 dias antes</option>
                </select>
              </div>
              <select name="renew" defaultValue="" className="field" aria-label="Renovação">
                <option value="">Não se repete</option>
                <option value="12">Renova todo ano</option>
                <option value="24">A cada 2 anos</option>
                <option value="60">A cada 5 anos</option>
                <option value="120">A cada 10 anos</option>
              </select>
              <button className="btn">Salvar</button>
            </form>
          </details>
        </div>

        <div className="card">
          <div className="eyebrow mb-1">🔁 Compras de rotina</div>
          {routines.length ? routines.map((r) => (
            <div key={r.id} className="row">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-[13px] text-ink-3">A cada ~{r.everyDays} dias · volta para a lista {r.nextDate <= today ? "hoje" : `em ${fmtBR(r.nextDate)}`}</div>
              </div>
              <XButton action={cancelRoutineAction.bind(null, r.id)} label={`Parar rotina de ${r.name}`} />
            </div>
          )) : <Empty>Diga “preciso comprar ração quando estiver acabando” ou “compro café toda semana”.</Empty>}
          <details className="mt-2 border-t border-line pt-2">
            <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">+ Nova compra de rotina</summary>
            <form action={addRoutineForm} className="mt-2 flex flex-col gap-2">
              <input name="item" required maxLength={80} placeholder="Item (ex.: Ração do cachorro)" className="field" aria-label="Item" />
              <select name="every" defaultValue="30" className="field" aria-label="Frequência">
                <option value="7">Toda semana</option>
                <option value="15">A cada 15 dias</option>
                <option value="30">Todo mês (~30 dias)</option>
                <option value="60">A cada 2 meses</option>
              </select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="now" className="h-4 w-4" /> Já está acabando — colocar na lista agora</label>
              <button className="btn">Salvar</button>
            </form>
          </details>
        </div>

        {showWar && (
          <div className="card">
            <div className="mb-1 flex items-baseline justify-between"><div className="eyebrow">🧾 Garantias e documentos (90 dias)</div><Link href="/casa?tab=garantias" className="text-sm font-semibold text-accent">Ver todos</Link></div>
            {[...exp.wars.map((w) => ({ k: "w" + w.id, name: `Garantia: ${w.item}`, d: w.expiresAt })), ...exp.docs.map((d) => ({ k: "d" + d.id, name: d.name, d: d.expiresAt! }))]
              .filter((x) => x.d >= addDays(today, -15)).sort((a, b) => a.d.localeCompare(b.d)).map((x) => {
                const n = diffDays(today, x.d);
                return (
                  <div key={x.k} className="row">
                    <span className="text-lg">{dot(n, 30)}</span>
                    <div className="min-w-0 flex-1"><div className="font-medium">{x.name}</div><div className="text-[13px] text-ink-3">{fmtBR(x.d)} · {quando(n)}</div></div>
                  </div>
                );
              })}
            {!exp.wars.length && !exp.docs.length && <Empty>Nada vencendo nos próximos 90 dias.</Empty>}
          </div>
        )}
      </div>
    </>
  );
}
