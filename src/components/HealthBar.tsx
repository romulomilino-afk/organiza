import type { Health } from "@/lib/health";

const DOT: Record<Health["level"], string> = { verde: "bg-good", amarelo: "bg-[#F2C75C]", vermelho: "bg-bad", sem_dados: "bg-line" };
const TEXT: Record<Health["level"], string> = { verde: "text-good", amarelo: "text-warn", vermelho: "text-bad", sem_dados: "text-ink-3" };

/** Barrinha vermelho · amarelo · verde com um marcador mostrando onde o mês está. */
export function HealthBar({ h, compact = false }: { h: Health; compact?: boolean }) {
  const off = h.level === "sem_dados";
  const dim = (l: Health["level"]) => (off || h.level === l ? "" : "opacity-35");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${compact ? "text-[13px]" : "text-[15px]"} ${TEXT[h.level]}`}>
          <i className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[h.level]}`} aria-hidden />{h.label}
        </span>
        {!compact && h.percent !== null && <span className="num text-[13px] text-ink-3">{h.percent >= 0 ? `sobra ${h.percent}% da renda` : `${-h.percent}% acima da renda`}</span>}
      </div>
      <div className="relative pt-2" role="img" aria-label={`Saúde financeira do mês: ${h.label}`}>
        <div className={`flex gap-1 ${off ? "opacity-30" : ""}`}>
          <span className={`h-2.5 flex-1 rounded-l-full bg-bad ${dim("vermelho")}`} />
          <span className={`h-2.5 flex-1 bg-[#F2C75C] ${dim("amarelo")}`} />
          <span className={`h-2.5 flex-1 rounded-r-full bg-good ${dim("verde")}`} />
        </div>
        {!off && (
          <span className="absolute top-[4px] -translate-x-1/2" style={{ left: `${h.position * 100}%` }} aria-hidden>
            <span className="block h-[18px] w-[18px] rounded-full border-[3px] border-surface bg-ink shadow" />
          </span>
        )}
      </div>
      {!compact && (
        <div className="mt-1 flex flex-col gap-1 text-[14px] text-ink-2">
          {h.reasons.map((r) => <p key={r}>{r}</p>)}
          {h.tip && <p className="text-ink-3">💡 {h.tip}</p>}
        </div>
      )}
    </div>
  );
}
