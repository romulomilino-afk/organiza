"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CATS = [["NOTA_FISCAL", "Nota fiscal"], ["DOCUMENTO", "Documento (RG, CNH…)"], ["CONTRATO", "Contrato"], ["GARANTIA", "Garantia"], ["MANUAL", "Manual"], ["OUTRO", "Outro"]];

const MAX = 4 * 1024 * 1024; // o Netlify não aceita envios muito maiores que isso

/** Foto grande do celular → JPEG menor (até 2000px), para caber no limite e subir rápido. */
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 1.2 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

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
    const fd = new FormData(e.currentTarget);
    const f = fd.get("file");
    if (f instanceof File && f.size > 0) {
      const small = await shrinkImage(f);
      if (small.size > MAX) { setBusy(false); return setError(f.type === "application/pdf" ? "O PDF passa de 4 MB. Tente uma versão menor (ou uma foto do documento)." : "A foto passa de 4 MB. Tente tirar de novo com menos zoom."); }
      fd.set("file", small, small.name);
    }
    const res = await fetch("/api/documents", { method: "POST", body: fd }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (res.status === 413 && !data.error) return setError("O arquivo é grande demais. Envie um de até 4 MB.");
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
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">Arquivo (PDF ou foto, até 4 MB)
        <input name="file" type="file" accept="application/pdf,image/*" className="text-sm font-normal" />
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
