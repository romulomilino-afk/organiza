import Link from "next/link";
import { APP_VERSION } from "@/lib/version";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userPreferences } from "@/db/schema";
import { requirePageAccess } from "@/lib/session";
import { PLANS, hasFeature } from "@/lib/plans";
import { memories } from "@/lib/data/queries";
import { usageThisMonth } from "@/lib/nina";
import { whatsappEnabled } from "@/lib/whatsapp";
import { deleteMemory, logout, updateName } from "@/actions/items";
import { saveNotificationPrefs } from "@/actions/casa";
import { disconnectWhatsApp } from "@/actions/whatsapp";
import { Empty, PageHeader, XButton } from "@/components/ui";
import { PushToggle } from "@/components/PushToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";

export default async function ConfigPage() {
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const [mems, usage, [prefs]] = await Promise.all([
    memories(db, user.id), usageThisMonth(db, user, access.plan),
    db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1),
  ]);
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  const plan = access.plan;

  return (
    <>
      <PageHeader title="Minha conta" subtitle={user.email} />
      <div className="flex flex-col gap-3">
        <div className="card flex flex-col gap-3">
          <div className="eyebrow">Seu nome</div>
          <form action={updateName} className="flex gap-2">
            <input name="name" defaultValue={user.name ?? ""} required maxLength={80} aria-label="Seu nome" className="field min-w-0 flex-1 py-2.5" />
            <button className="btn btn-ghost">Salvar</button>
          </form>
        </div>

        <div className="card flex flex-col gap-2">
          <div className="flex items-baseline justify-between"><div className="eyebrow">Plano</div><Link href="/planos" className="text-sm font-semibold text-accent">Ver planos</Link></div>
          <b className="font-display text-xl">{PLANS[plan].name}{plan !== access.ownPlan ? " · pela família" : ""}</b>
          <div className="text-sm text-ink-2">Conversas com a Nina este mês: <b className="num">{usage.used}</b> de {usage.limit}</div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2"><i className={`block h-full rounded-full ${pct > 85 ? "bg-warn" : "bg-accent"}`} style={{ width: `${pct}%` }} /></div>
        </div>

        <Link href="/familia" className="card flex items-center justify-between">
          <div><div className="eyebrow mb-1">Família</div><div className="font-medium">{access.household ? access.household.name : "Organizem a casa juntos"}</div></div>
          <span className="text-ink-3">›</span>
        </Link>

        <div className="card flex flex-col gap-3">
          <div className="eyebrow">Avisos</div>
          <PushToggle />
          <form action={saveNotificationPrefs} className="flex flex-col gap-2 border-t border-line pt-3">
            <label className="flex items-center gap-2 text-[15px]"><input type="checkbox" name="enabled" defaultChecked={prefs?.notificationsEnabled ?? true} className="h-5 w-5 accent-[var(--accent)]" /> Receber avisos da Nina</label>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              Silêncio das <input type="time" name="quietStart" defaultValue={prefs?.quietHoursStart ?? "22:00"} aria-label="Início do silêncio" className="field w-auto py-1.5" />
              às <input type="time" name="quietEnd" defaultValue={prefs?.quietHoursEnd ?? "07:00"} aria-label="Fim do silêncio" className="field w-auto py-1.5" />
            </div>
            <p className="text-xs text-ink-3">Lembretes com horário marcado por você tocam mesmo no silêncio.</p>
            <button className="btn btn-ghost w-fit">Salvar avisos</button>
          </form>
        </div>

        <div className="card flex flex-col gap-2">
          <div className="eyebrow">WhatsApp</div>
          {!whatsappEnabled() ? <p className="text-sm text-ink-2">A Nina no WhatsApp ainda não foi configurada neste servidor.</p>
            : !hasFeature(plan, "whatsapp") ? <p className="text-sm text-ink-2">Converse com a Nina pelo WhatsApp no plano Premium. <Link href="/planos" className="font-semibold text-accent">Ver planos</Link></p>
            : user.phone ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[15px]">✅ Conectado: <b className="num">+{user.phone}</b></p>
                <form action={disconnectWhatsApp}><button className="btn btn-ghost px-3 py-1.5 text-sm">Desconectar</button></form>
              </div>
            ) : (<>
              <p className="text-sm text-ink-2">Mande mensagens e áudios para a Nina direto do WhatsApp.</p>
              <WhatsAppLink number={process.env.WHATSAPP_DISPLAY_NUMBER ?? null} />
            </>)}
        </div>

        {hasFeature(plan, "memoria") && (
          <div className="card">
            <div className="eyebrow mb-1.5">🧠 O que a Nina sabe sobre você</div>
            {mems.length ? mems.map((m) => (
              <div key={m.id} className="row"><div className="min-w-0 flex-1">{m.fact}</div><XButton action={deleteMemory.bind(null, m.id)} label="Esquecer" /></div>
            )) : <Empty>Conte coisas como “Meu filho Gabriel tem futebol toda terça às 18h”.</Empty>}
          </div>
        )}

        <form action={logout}><button className="btn btn-ghost w-full">Sair</button></form>
        <p className="text-center text-[12px] text-ink-3">Organiza · versão {APP_VERSION}</p>
      </div>
    </>
  );
}
