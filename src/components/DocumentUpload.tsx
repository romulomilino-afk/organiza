"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CATS = [["NOTA_FISCAL", "Nota fiscal"], ["DOCUMENTO", "Documento (RG, CNH…)"], ["CONTRATO", "Contrato"], ["GARANTIA", "Garantia"], ["MANUAL", "Manual"], ["OUTRO", "Outro"]];

export function DocumentUpload() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState("NOTA_FISCAL");
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/documents", { method: "POST", body: new FormData(e.currentTarget) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Não consegui guardar o documento.");
    formRef.current?.reset(); setOpen(false); router.refresh();
  }

  if (!open) return <button className="btn w-fit" onClick={() => setOpen(true)}>+ Guardar documento</button>;
  return (
    <form ref={formRef} onSubmit={submit} className="card flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Nome
        <input name="name" required maxLength={120} placeholder="Ex.: Nota fiscal da geladeira, CNH" className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Tipo
        <select name="category" value={cat} onChange={(e) => setCat(e.target.value)} className="field font-normal">
          {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {(cat === "GARANTIA" || cat === "NOTA_FISCAL") && (
        <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Garantia (meses, opcional)
          <input name="warrantyMonths" type="number" min={1} max={240} inputMode="numeric" placeholder="12" className="field font-normal" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Vencimento (opcional)
        <input name="expiresAt" type="date" className="field font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Arquivo (PDF ou foto, até 10 MB)
        <input name="file" type="file" accept="application/pdf,image/*" capture="environment" className="text-sm font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Observações
        <textarea name="notes" rows={2} maxLength={500} className="field font-normal" />
      </label>
      {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancelar</button>
        <button disabled={busy} className="btn">{busy ? "Guardando…" : "Guardar"}</button>
      </div>
      <p className="text-xs text-ink-3">🔒 O arquivo é criptografado antes de ser guardado. Só você consegue abrir.</p>
    </form>
  );
}
