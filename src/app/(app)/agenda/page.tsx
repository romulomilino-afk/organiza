import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { addDays, DIAS, fmtShort, relDay, todayIn, weekday } from "@/lib/dates";
import { brl } from "@/lib/money";
import { recurrenceLabel } from "@/lib/recurrence";
import { doneTasks, ensureRecurringBills, occurrences, openReminders, openTasks, pendingBills } from "@/lib/data/queries";
import { addTask, cancelEvent, completeReminder, deleteTask, payBill, postponeTask, toggleTask } from "@/actions/items";
import { CheckButton, Empty, PageHeader, SmallButton, XButton } from "@/components/ui";
import { and, eq, ne } from "drizzle-orm";
import { events } from "@/db/schema";

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const today = todayIn(user.timezone);
  const isTasks = tab === "tarefas";

  const tabs = (
    <div className="mb-3 flex w-fit gap-1.5 rounded-full bg-surface-2 p-1" role="tablist">
      {[["", "Próximos dias"], ["tarefas", "Tarefas"]].map(([k, l]) => {
        const on = (k === "tarefas") === isTasks;
        return <Link key={k} href={k ? `/agenda?tab=${k}` : "/agenda"} role="tab" aria-selected={on}
          className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${on ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}>{l}</Link>;
      })}
    </div>
  );

  if (isTasks) {
    const [open, done] = await Promise.all([openTasks(db, access), doneTasks(db, access, 8)]);
    return (
      <>
        <PageHeader title="Agenda" subtitle="Compromissos, lembretes e tarefas" />
        {tabs}
        <form action={addTask} className="mb-3 flex gap-2">
          <input name="title" required maxLength={160} placeholder="Nova tarefa" aria-label="Nova tarefa" className="field min-w-0 flex-1 py-2.5" />
          <button className="btn">Adicionar</button>
        </form>
        <div className="card">
          {open.length ? open.map((t) => {
            const late = !!t.dueDate && t.dueDate < today;
            return (
              <div key={t.id} className="row">
                <CheckButton action={toggleTask.bind(null, t.id)} checked={false} label={`Concluir ${t.title}`} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium [overflow-wrap:anywhere]">{t.title}</div>
                  {t.dueDate && <div className={`text-[13px] ${late ? "font-semibold text-bad" : "text-ink-3"}`}>{late ? "Atrasada · " : ""}{relDay(t.dueDate, today)}</div>}
                </div>
                {t.dueDate && <SmallButton action={postponeTask.bind(null, t.id)}>Amanhã</SmallButton>}
                <XButton action={deleteTask.bind(null, t.id)} label={`Apagar ${t.title}`} />
              </div>
            );
          }) : <Empty>Nenhuma pendência. 🎉 Diga “preciso renovar o seguro sexta”.</Empty>}
        </div>
        {done.length > 0 && (<>
          <div className="eyebrow mt-5 mb-2">Concluídas</div>
          <div className="card">
            {done.map((t) => (
              <div key={t.id} className="row">
                <CheckButton action={toggleTask.bind(null, t.id)} checked label={`Reabrir ${t.title}`} />
                <div className="min-w-0 flex-1 text-ink-3 line-through">{t.title}</div>
              </div>
            ))}
          </div>
        </>)}
      </>
    );
  }

  await ensureRecurringBills(db, user.id, today, user.timezone);
  const until = addDays(today, 20);
  const [occ, rems, bills, routines] = await Promise.all([
    occurrences(db, access, today, until),
    openReminders(db, user.id, addDays(today, -7), until),
    pendingBills(db, access, until),
    db.select().from(events).where(and(eq(events.userId, user.id), eq(events.cancelled, false), ne(events.recurrence, "NONE"))),
  ]);

  const days: string[] = [];
  for (let d = today; d <= until; d = addDays(d, 1)) days.push(d);
  const blocks = days.map((d) => ({
    d,
    evs: occ.filter((o) => o.day === d),
    rems: rems.filter((r) => r.date === d || (d === today && r.date < today)),
    bills: bills.filter((b) => b.dueDate === d || (d === today && b.dueDate! < today)),
  })).filter((b) => b.evs.length || b.rems.length || b.bills.length);

  return (
    <>
      <PageHeader title="Agenda" subtitle="Compromissos, lembretes e tarefas" />
      {tabs}
      <div className="flex flex-col gap-2">
        {blocks.length ? blocks.map(({ d, evs, rems: rs, bills: bs }) => (
          <div key={d}>
            <div className="mt-1.5 mb-1.5 font-display text-[15px] font-semibold">{relDay(d, today)}<span className="ml-1.5 font-sans text-[13px] font-normal text-ink-3">{DIAS[weekday(d)].slice(0, 3)}, {fmtShort(d)}</span></div>
            <div className="card">
              {evs.map(({ event: e }) => (
                <div key={e.id + d} className="row">
                  <span className="num min-w-12 text-[15px] font-semibold text-accent">{e.time ?? "—"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium [overflow-wrap:anywhere]">{e.title}</div>
                    <div className="text-[13px] text-ink-3">{[e.recurrence !== "NONE" && recurrenceLabel(e), e.remindDaysBefore && `🔔 ${e.remindDaysBefore}d antes`].filter(Boolean).join(" · ")}</div>
                  </div>
                  <XButton action={cancelEvent.bind(null, e.id, d, false)} label={e.recurrence !== "NONE" ? "Remover deste dia" : "Cancelar compromisso"} />
                </div>
              ))}
              {rs.map((r) => (
                <div key={r.id} className="row">
                  <span className="num min-w-12 text-[15px] font-semibold text-accent">{r.time ?? "—"}</span>
                  <div className="min-w-0 flex-1"><div className="font-medium">🔔 {r.text}</div><div className={`text-[13px] ${r.date < today ? "text-bad" : "text-ink-3"}`}>{r.date < today ? `Lembrete de ${relDay(r.date, today).toLowerCase()}` : "Lembrete"}</div></div>
                  <CheckButton action={completeReminder.bind(null, r.id)} checked={false} label="Concluir lembrete" />
                </div>
              ))}
              {bs.map((b) => (
                <div key={b.id} className="row">
                  <span className="min-w-12 text-center">🧾</span>
                  <div className="min-w-0 flex-1"><div className="font-medium">{b.description}</div><div className={`text-[13px] ${b.dueDate! < today ? "font-semibold text-bad" : "text-ink-3"}`}>{b.dueDate! < today ? "Vencida" : "Vencimento"}{b.amountCents ? ` · ${brl(b.amountCents)}` : ""}</div></div>
                  <SmallButton action={payBill.bind(null, b.id)}>Paguei</SmallButton>
                </div>
              ))}
            </div>
          </div>
        )) : <div className="card"><Empty>Nada nas próximas 3 semanas. Diga “Tenho dentista dia 20 às 14h”.</Empty></div>}
      </div>

      {routines.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[17px] font-semibold">Rotina</h2>
          <div className="card">
            {routines.map((e) => (
              <div key={e.id} className="row">
                <span className="num min-w-12 text-[15px] font-semibold text-accent">{e.time ?? "—"}</span>
                <div className="min-w-0 flex-1"><div className="font-medium">{e.title}</div><div className="text-[13px] text-ink-3">{recurrenceLabel(e)}</div></div>
                <XButton action={cancelEvent.bind(null, e.id, undefined, true)} label="Encerrar rotina" />
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
