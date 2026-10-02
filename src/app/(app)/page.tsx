import Link from "next/link";
import { unpaidInvoicesDue } from "@/lib/cards";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { addDays, DIAS, fmtLong, todayIn, weekday } from "@/lib/dates";
import { brl } from "@/lib/money";
import { hasFeature, type PlanId } from "@/lib/plans";
import { recurrenceLabel } from "@/lib/recurrence";
import { computeAlerts } from "@/lib/data/alerts";
import { dismissedKeys, ensureRecurringBills, expiringItems, monthFinance, occurrences, openReminders, openTasks, pendingBills, shoppingOpen } from "@/lib/data/queries";
import { PushToggle } from "@/components/PushToggle";
import { dismissAlert, toggleShopping } from "@/actions/items";
import { HomeNina } from "@/components/HomeNina";
import { CheckButton, Empty, XButton } from "@/components/ui";
import { IconUser } from "@/components/icons";

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default async function HomePage() {
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const today = todayIn(user.timezone);
  await ensureRecurringBills(db, user.id, today, user.timezone);

  const [occ, rems, tks, fin, bills, shop, exp] = await Promise.all([
    occurrences(db, access, today, addDays(today, 7)),
    openReminders(db, user.id, addDays(today, -3), today),
    openTasks(db, access),
    monthFinance(db, user.id, today),
    pendingBills(db, access, addDays(today, 2)),
    shoppingOpen(db, access),
    expiringItems(db, user.id, addDays(today, 30)),
  ]);

  const agenda = [
    ...occ.filter((o) => o.day === today).map((o) => ({ time: o.event.time, title: o.event.title, sub: o.event.recurrence !== "NONE" ? recurrenceLabel(o.event) : "" })),
    ...rems.filter((r) => r.date === today).map((r) => ({ time: r.time, title: `🔔 ${r.text}`, sub: "Lembrete" })),
  ].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));

  const late = tks.filter((t) => t.dueDate && t.dueDate < today);
  const forToday = tks.filter((t) => t.dueDate === today);
  const noDate = tks.filter((t) => !t.dueDate);

  const uniqueEvents = [...new Map(occ.map((o) => [o.event.id, o.event])).values()];
  const allAlerts = computeAlerts({ today, tz: user.timezone, events: uniqueEvents, bills, tasks: tks, shopping: shop, reminders: rems, docs: exp.docs, warranties: exp.wars, invoices: await unpaidInvoicesDue(db, user.id, today, addDays(today, 3)) });
  const dismissed = await dismissedKeys(db, user.id, allAlerts.map((a) => a.key));
  const alerts = allAlerts.filter((a) => !dismissed.has(a.key)).slice(0, 4);
  const plan = access.plan;
  const showFinance = hasFeature(plan, "financeiro");

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-tight">Olá, {user.name?.split(" ")[0] || "você"} 👋</h1>
          <p className="mt-1 text-sm text-ink-3">{greeting(user.timezone)} · {DIAS[weekday(today)]}, {fmtLong(today)}</p>
        </div>
        <Link href="/config" aria-label="Minha conta" className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-ink-2"><IconUser className="h-5 w-5" /></Link>
      </header>

      <p className="mt-4 text-center font-display text-lg text-ink-2">Como posso te ajudar hoje?</p>
      <HomeNina canVoice={hasFeature(plan, "audio")} />

      <div className="mt-5"><PushToggle compact /></div>

      <section className="mt-7 flex flex-col gap-3">
        <div className="flex items-baseline justify-between"><h2 className="text-xl font-semibold">Resumo do dia</h2><Link href="/agenda" className="text-sm font-semibold text-accent">Agenda</Link></div>

        <div className="card">
          <div className="eyebrow mb-2">📅 Hoje</div>
          {agenda.length ? agenda.map((e, i) => (
            <div key={i} className="row">
              <span className="num min-w-12 text-[15px] font-semibold text-accent">{e.time ?? "—"}</span>
              <div className="min-w-0 flex-1"><div className="font-medium [overflow-wrap:anywhere]">{e.title}</div>{e.sub && <div className="text-[13px] text-ink-3">{e.sub}</div>}</div>
            </div>
          )) : <Empty>Nada marcado para hoje. Diga, por exemplo: “Hoje às 18h busco meu filho”.</Empty>}
        </div>

        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          <Link href="/agenda?tab=tarefas" className="card block">
            <div className="eyebrow mb-2">✅ Pendências</div>
            <div className="flex flex-col items-start gap-1.5">
              {late.length > 0 && <span className="pill pill-bad">🔴 {late.length} atrasada{late.length > 1 ? "s" : ""}</span>}
              <span className="pill pill-warn">🟡 {forToday.length} para hoje</span>
              {noDate.length > 0 && <span className="pill pill-ok">{noDate.length} sem data</span>}
            </div>
          </Link>
          {showFinance ? (
            <Link href="/financeiro" className="card block">
              <div className="eyebrow mb-1">💰 Gastos hoje</div>
              <div className="num font-display text-[26px] font-semibold leading-tight">{brl(fin.todayCents)}</div>
              <div className="text-[13px] text-ink-3">Saldo do mês: <b className={`num ${fin.balanceCents < 0 ? "text-bad" : "text-good"}`}>{brl(fin.balanceCents)}</b></div>
            </Link>
          ) : (
            <Link href="/config" className="card block">
              <div className="eyebrow mb-1">💰 Financeiro</div>
              <p className="text-sm text-ink-2">Registre gastos só falando. Disponível no Premium.</p>
            </Link>
          )}
        </div>

        <div className="card">
          <div className="eyebrow mb-2">🔔 Alertas</div>
          {alerts.length ? alerts.map((a) => (
            <div key={a.key} className="row items-start">
              <span className="text-[17px] leading-snug">{a.icon}</span>
              <div className="min-w-0 flex-1 text-[15px]">{a.text}</div>
              <XButton action={dismissAlert.bind(null, a.key, a.kind, a.text)} label="Dispensar alerta" />
            </div>
          )) : <Empty>Tudo tranquilo. Eu aviso quando algo estiver chegando.</Empty>}
        </div>

        <div className="card">
          <div className="mb-1.5 flex items-baseline justify-between"><div className="eyebrow">🛒 Compras</div><Link href="/casa" className="text-sm font-semibold text-accent">Ver lista</Link></div>
          {shop.length ? (<>
            {shop.slice(0, 5).map((i) => (
              <div key={i.id} className="row"><CheckButton action={toggleShopping.bind(null, i.id)} checked={false} label={`Marcar ${i.name} como comprado`} /><div className="min-w-0 flex-1 font-medium">{i.name}</div></div>
            ))}
            {shop.length > 5 && <p className="mt-1 text-[13px] text-ink-3">+ {shop.length - 5} itens</p>}
          </>) : <Empty>Lista vazia. Diga “estou sem arroz e leite”.</Empty>}
        </div>
      </section>
    </>
  );
}
