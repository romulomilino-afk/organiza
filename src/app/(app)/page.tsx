import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { DIAS, fmtLong, todayIn, weekday } from "@/lib/dates";
import { brl } from "@/lib/money";
import { hasFeature } from "@/lib/plans";
import { dismissedKeys, ensureRecurringBills } from "@/lib/data/queries";
import { buildPendencias, DOT, type Pend } from "@/lib/data/pendencias";
import { ensureRoutines } from "@/lib/watch";
import { monthBudget } from "@/lib/budget";
import { PushToggle } from "@/components/PushToggle";
import { dismissAlert, payBill, toggleShopping, toggleTask } from "@/actions/items";
import { payInvoiceAction } from "@/actions/cards";
import { completeDeadlineAction } from "@/actions/watch";
import { HomeNina } from "@/components/HomeNina";
import { CheckButton, SmallButton, XButton } from "@/components/ui";
import { IconUser } from "@/components/icons";

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function PendAction({ p }: { p: Pend }) {
  const a = p.action;
  switch (a.kind) {
    case "task": return <CheckButton action={toggleTask.bind(null, a.id)} checked={false} label={`Concluir ${p.text}`} />;
    case "shop": return <CheckButton action={toggleShopping.bind(null, a.id)} checked={false} label={`Marcar ${p.text} como comprado`} />;
    case "bill": return <SmallButton action={payBill.bind(null, a.id)}>Paguei</SmallButton>;
    case "invoice": return <SmallButton action={payInvoiceAction.bind(null, a.cardId, a.dueDate)}>Paguei</SmallButton>;
    case "deadline": return <SmallButton action={completeDeadlineAction.bind(null, a.id)}>{a.renews ? "Renovei" : "Feito"}</SmallButton>;
    case "dismiss": return <XButton action={dismissAlert.bind(null, p.key, "pendencia", p.text)} label="Dispensar" />;
    default: return null;
  }
}

export default async function HomePage() {
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const today = todayIn(user.timezone);
  await ensureRecurringBills(db, user.id, today, user.timezone);
  await ensureRoutines(db, access, today);

  const showFinance = hasFeature(access.plan, "financeiro");
  const [pend, budget] = await Promise.all([
    buildPendencias(db, access, today, (keys) => dismissedKeys(db, user.id, keys)),
    showFinance ? monthBudget(db, user.id, today, user.timezone) : Promise.resolve(null),
  ]);
  const first = user.name?.split(" ")[0] || "você";
  const reds = pend.filter((p) => p.color === "red").length;

  return (
    <>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold leading-tight">{greeting(user.timezone)}, {first} 👋</h1>
          <p className="mt-1 text-sm text-ink-3">{DIAS[weekday(today)]}, {fmtLong(today)}</p>
        </div>
        <Link href="/config" aria-label="Minha conta" className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-ink-2"><IconUser className="h-5 w-5" /></Link>
      </header>

      <section className="card mt-4" aria-labelledby="hoje">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 id="hoje" className="text-xl font-semibold">Hoje</h2>
          <span className="text-[13px] text-ink-3">{pend.length ? `${pend.length} ${pend.length === 1 ? "coisa" : "coisas"}${reds ? ` · ${reds} urgente${reds > 1 ? "s" : ""}` : ""}` : ""}</span>
        </div>
        {pend.length ? pend.slice(0, 12).map((p) => {
          const body = (
            <div className="min-w-0 flex-1">
              <div className="font-medium leading-snug [overflow-wrap:anywhere]">{p.text}</div>
              {p.sub && <div className="text-[13px] text-ink-3">{p.sub}</div>}
            </div>
          );
          return (
            <div key={p.key} className="row">
              <span className="w-6 flex-none text-center text-[15px]" aria-hidden>{DOT[p.color]}</span>
              {p.href ? <Link href={p.href} className="min-w-0 flex-1">{body}</Link> : body}
              <PendAction p={p} />
            </div>
          );
        }) : (
          <p className="py-2 text-[15px] text-ink-2">Tudo em dia! ✨ Nada vencendo, nada atrasado.</p>
        )}
        {pend.length > 12 && <Link href="/pendencias" className="mt-1 block text-sm font-semibold text-accent">Ver mais {pend.length - 12}</Link>}

        <div className="mt-3 border-t border-line pt-4">
          <p className="text-center font-display text-[17px] text-ink-2">Tem algo que você precisa resolver? 🎙️</p>
          <HomeNina canVoice={hasFeature(access.plan, "audio")} />
        </div>
      </section>

      <div className="mt-4"><PushToggle compact /></div>

      <div className="mt-4 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
        {budget ? (
          <Link href="/financeiro#posso-gastar" className="card block">
            <div className="eyebrow mb-1">💡 Posso gastar?</div>
            {budget.hasIncome ? (
              <>
                <div className={`num font-display text-[24px] font-semibold leading-tight ${budget.marginCents < 0 ? "text-bad" : "text-good"}`}>{budget.marginCents < 0 ? brl(budget.marginCents) : brl(budget.freeCents)}</div>
                <div className="text-[13px] text-ink-3">{budget.marginCents < 0 ? "no vermelho este mês" : `livres este mês · ~${brl(budget.perDayCents)}/dia`}</div>
              </>
            ) : <p className="text-sm text-ink-2">Me diga sua renda e eu calculo quanto sobra no mês.</p>}
          </Link>
        ) : (
          <Link href="/planos" className="card block">
            <div className="eyebrow mb-1">💡 Posso gastar?</div>
            <p className="text-sm text-ink-2">Eu analiso renda, contas, cartão e parcelas e digo quanto sobra. No Premium.</p>
          </Link>
        )}
        <Link href="/pendencias" className="card block">
          <div className="eyebrow mb-1">📌 Não deixe nada passar</div>
          <p className="text-sm text-ink-2">Vencimentos, renovações, garantias e compras de rotina num lugar só.</p>
        </Link>
      </div>
    </>
  );
}
