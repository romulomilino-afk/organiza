import Link from "next/link";
import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { diffDays, fmtBR, todayIn } from "@/lib/dates";
import { brl } from "@/lib/money";
import { hasFeature, type Feature } from "@/lib/plans";
import { activeSubscriptions, listDocuments, listWarranties, shoppingChecked, shoppingOpen } from "@/lib/data/queries";
import { addShopping, clearCheckedShopping, deleteShopping, toggleShopping } from "@/actions/items";
import { addSubscription, addWarranty, cancelSubscription, deleteDocument, deleteWarranty } from "@/actions/casa";
import { CheckButton, Empty, PageHeader, XButton } from "@/components/ui";
import { DocumentUpload } from "@/components/DocumentUpload";

const TABS = [["compras", "Compras"], ["documentos", "Documentos"], ["garantias", "Garantias"], ["assinaturas", "Assinaturas"]] as const;
const DOC_ICON: Record<string, string> = { NOTA_FISCAL: "🧾", DOCUMENTO: "🪪", CONTRATO: "📑", GARANTIA: "🛡️", MANUAL: "📘", OUTRO: "📄" };
const DOC_LABEL: Record<string, string> = { NOTA_FISCAL: "Nota fiscal", DOCUMENTO: "Documento", CONTRATO: "Contrato", GARANTIA: "Garantia", MANUAL: "Manual", OUTRO: "Outro" };

function Premium({ what }: { what: string }) {
  return (
    <div className="card flex flex-col gap-3">
      <p className="text-ink-2">{what} faz parte do plano Premium.</p>
      <Link href="/planos" className="btn w-fit">Ver planos</Link>
    </div>
  );
}

function expiryPill(date: string, today: string) {
  const n = diffDays(today, date);
  return <span className={`pill ${n < 0 ? "pill-bad" : n <= 30 ? "pill-warn" : "pill-ok"}`}>{n < 0 ? "Vencido" : fmtBR(date)}</span>;
}

export default async function CasaPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "compras" } = await searchParams;
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const today = todayIn(user.timezone);
  const can = (f: Feature) => hasFeature(access.plan, f);
  const shared = !!access.household?.active;

  let body: React.ReactNode = null;
  if (tab === "documentos") {
    if (!can("documentos")) body = <Premium what="Guardar documentos" />;
    else {
      const docs = await listDocuments(db, user.id);
      body = (<>
        <DocumentUpload />
        <div className="card mt-3">
          {docs.length ? docs.map((d) => (
            <div key={d.id} className="row">
              <span className="text-xl">{DOC_ICON[d.category]}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium [overflow-wrap:anywhere]">
                  {d.fileKey ? <a href={`/api/documents/${d.id}/file?view=1`} target="_blank" rel="noopener" className="underline decoration-line underline-offset-4">{d.name}</a> : d.name}
                </div>
                <div className="text-[13px] text-ink-3">{DOC_LABEL[d.category]} · {fmtBR(d.date)}{d.notes ? ` · ${d.notes}` : ""}</div>
              </div>
              {d.expiresAt && expiryPill(d.expiresAt, today)}
              <XButton action={deleteDocument.bind(null, d.id)} label={`Apagar ${d.name}`} />
            </div>
          )) : <Empty>Guarde notas fiscais, contratos, manuais e documentos com vencimento. Eu aviso antes de vencer.</Empty>}
        </div>
      </>);
    }
  } else if (tab === "garantias") {
    if (!can("garantias")) body = <Premium what="Controlar garantias" />;
    else {
      const wars = await listWarranties(db, user.id);
      body = (<>
        <form action={addWarranty} className="card mb-3 grid grid-cols-[1fr_auto] gap-2 min-[420px]:grid-cols-[1fr_90px_auto]">
          <input name="item" required maxLength={80} placeholder="Produto (ex.: geladeira)" aria-label="Produto" className="field min-w-0 py-2.5" />
          <input name="months" required type="number" min={1} max={240} placeholder="Meses" aria-label="Meses de garantia" className="field py-2.5" />
          <button className="btn col-span-2 min-[420px]:col-span-1">Adicionar</button>
        </form>
        <div className="card">
          {wars.length ? wars.map((w) => (
            <div key={w.id} className="row">
              <span className="text-xl">🛡️</span>
              <div className="min-w-0 flex-1"><div className="font-medium">Garantia do {w.item.toLowerCase()}</div><div className="text-[13px] text-ink-3">Comprado em {fmtBR(w.purchaseDate)} · {w.months} meses</div></div>
              {expiryPill(w.expiresAt, today)}
              <XButton action={deleteWarranty.bind(null, w.id)} label="Apagar garantia" />
            </div>
          )) : <Empty>Diga “Comprei um ar-condicionado hoje” e eu pergunto sobre a garantia.</Empty>}
        </div>
      </>);
    }
  } else if (tab === "assinaturas") {
    if (!can("assinaturas")) body = <Premium what="Controlar assinaturas" />;
    else {
      const subs = await activeSubscriptions(db, user.id);
      const monthly = subs.reduce((a, s) => a + (s.cycle === "YEARLY" ? s.amountCents / 12 : s.amountCents), 0);
      body = (<>
        <div className="card mb-3 grid grid-cols-2 gap-3">
          <div><div className="text-[13px] font-semibold text-ink-3">Total mensal</div><div className="num font-display text-[24px] font-semibold">{brl(Math.round(monthly))}</div></div>
          <div><div className="text-[13px] font-semibold text-ink-3">Total anual estimado</div><div className="num font-display text-[24px] font-semibold">{brl(Math.round(monthly * 12))}</div></div>
        </div>
        <form action={addSubscription} className="card mb-3 grid grid-cols-2 gap-2 min-[420px]:grid-cols-[1fr_100px_110px_auto]">
          <input name="name" required maxLength={80} placeholder="Ex.: Netflix" aria-label="Assinatura" className="field col-span-2 min-w-0 py-2.5 min-[420px]:col-span-1" />
          <input name="amount" required inputMode="decimal" placeholder="39,90" aria-label="Valor" className="field py-2.5" />
          <select name="cycle" aria-label="Frequência" className="field py-2.5"><option value="MONTHLY">Mensal</option><option value="YEARLY">Anual</option></select>
          <button className="btn col-span-2 min-[420px]:col-span-1">Adicionar</button>
        </form>
        <div className="card">
          {subs.length ? subs.map((s) => (
            <div key={s.id} className="row">
              <span className="text-xl">🔄</span>
              <div className="min-w-0 flex-1 font-medium">{s.name}<div className="text-[13px] font-normal text-ink-3">{s.cycle === "YEARLY" ? "Anual" : "Mensal"}</div></div>
              <span className="num font-semibold">{brl(s.amountCents)}</span>
              <XButton action={cancelSubscription.bind(null, s.id)} label={`Cancelar ${s.name}`} />
            </div>
          )) : <Empty>Diga “Assino Netflix por 39,90 por mês” ou adicione acima.</Empty>}
        </div>
      </>);
    }
  } else {
    const [open, got] = await Promise.all([shoppingOpen(db, access), shoppingChecked(db, access)]);
    body = (<>
      <form action={addShopping} className="mb-3 flex gap-2">
        <input name="items" required maxLength={400} placeholder="Adicionar (ex.: arroz, leite e café)" aria-label="Adicionar itens" className="field min-w-0 flex-1 py-2.5" />
        <button className="btn">Adicionar</button>
      </form>
      <div className="card">
        <div className="eyebrow mb-1.5">🛒 {shared ? "Lista da família" : "Lista de compras"}</div>
        {open.length ? open.map((i) => {
          const days = diffDays(todayIn(user.timezone, i.createdAt), today);
          return (
            <div key={i.id} className="row">
              <CheckButton action={toggleShopping.bind(null, i.id)} checked={false} label={`Marcar ${i.name} como comprado`} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.name}{i.quantity ? ` · ${i.quantity}` : ""}</div>
                {days >= 1 && <div className={`text-[13px] ${days >= 5 ? "text-warn" : "text-ink-3"}`}>na lista há {days} dia{days > 1 ? "s" : ""}</div>}
              </div>
              <XButton action={deleteShopping.bind(null, i.id)} label={`Remover ${i.name}`} />
            </div>
          );
        }) : <Empty>Nada na lista. Diga “estou sem café e leite”.</Empty>}
      </div>
      {got.length > 0 && (
        <div className="card mt-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <div className="eyebrow">Comprados</div>
            <form action={clearCheckedShopping}><button className="text-sm font-semibold text-accent">Limpar</button></form>
          </div>
          {got.map((i) => (
            <div key={i.id} className="row">
              <CheckButton action={toggleShopping.bind(null, i.id)} checked label={`Voltar ${i.name} para a lista`} />
              <div className="min-w-0 flex-1 text-ink-3 line-through">{i.name}</div>
            </div>
          ))}
        </div>
      )}
    </>);
  }

  return (
    <>
      <PageHeader title="Minha Casa" subtitle="Compras, documentos, garantias e assinaturas" />
      <div className="-mx-4 mb-3 overflow-x-auto px-4 [scrollbar-width:none]">
        <div className="flex w-fit gap-1.5 rounded-full bg-surface-2 p-1" role="tablist">
          {TABS.map(([k, l]) => (
            <Link key={k} href={k === "compras" ? "/casa" : `/casa?tab=${k}`} role="tab" aria-selected={tab === k}
              className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${tab === k ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}>{l}</Link>
          ))}
        </div>
      </div>
      {body}
    </>
  );
}
