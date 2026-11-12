"use client";
/** Troca a categoria de uma compra no cartão: escolheu, já salva. */
export function CategoryPicker({ action, purchaseId, value, options, label }: {
  action: (form: FormData) => Promise<void>; purchaseId: string; value: string;
  options: { key: string; name: string; emoji: string }[]; label: string;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <select name="category" defaultValue={value} aria-label={label}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="max-w-[11rem] rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[12px] font-semibold text-ink-2">
        {options.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.name}</option>)}
      </select>
    </form>
  );
}
