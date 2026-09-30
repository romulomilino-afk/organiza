import { IconCheck } from "./icons";

/** Botões que disparam server actions (funcionam até sem JavaScript). */
export function CheckButton({ action, checked, label }: { action: () => Promise<void>; checked: boolean; label: string }) {
  return (
    <form action={action}>
      <button aria-label={label} className={`grid h-6 w-6 flex-none place-items-center rounded-lg border-2 ${checked ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface"}`}>
        {checked && <IconCheck className="h-3.5 w-3.5" />}
      </button>
    </form>
  );
}

export function XButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <button aria-label={label} className="rounded-lg px-1.5 py-1 text-lg leading-none text-ink-3 hover:bg-surface-2 hover:text-bad">×</button>
    </form>
  );
}

export function SmallButton({ action, children }: { action: () => Promise<void>; children: React.ReactNode }) {
  return (
    <form action={action}>
      <button className="btn btn-ghost whitespace-nowrap px-3 py-1.5 text-sm">{children}</button>
    </form>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-sm text-ink-3">{children}</p>;
}
