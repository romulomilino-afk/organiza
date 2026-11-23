import Link from "next/link";
import type { Metadata } from "next";
import { PLANS } from "@/lib/plans";
import { brl } from "@/lib/money";
import { MetaView } from "@/components/MetaView";

/**
 * Página do anúncio (tráfego pago): o mesmo gancho dos criativos, um só objetivo — criar a conta.
 * Sem menu, sem links para fora do funil.
 */
export const metadata: Metadata = {
  title: "O salário some em 2 semanas? · Meu Organiza",
  description: "Fale o que gastou e a Nina organiza: separa por categoria, avisa as contas e diz quanto ainda dá pra gastar. Comece grátis.",
};

const G = "#17624F", Y = "#F2C75C", N = "#0F2A22", C = "#F6F5F0", T = "#14231E", B = "#44504B", M = "#C9DBD3";
const CTA = "/cadastro?origem=comecar";

function Sym({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex flex-none items-center justify-center" style={{ width: size, height: size, borderRadius: size * 0.24, background: G }}>
      <span style={{ width: size * 0.37, height: size * 0.37, borderRadius: "50%", background: Y }} />
    </span>
  );
}

function Cta({ children = "Começar grátis", dark = false }: { children?: React.ReactNode; dark?: boolean }) {
  return (
    <Link href={CTA} className="inline-block w-full rounded-2xl px-7 py-4 text-center text-[18px] font-bold shadow-sm sm:w-auto"
      style={dark ? { background: G, color: C } : { background: Y, color: N }}>{children}</Link>
  );
}

const PASSOS = [
  { n: "1", t: "Crie sua conta grátis", d: "Leva 30 segundos. Não pede cartão." },
  { n: "2", t: "Conte para a Nina", d: "“Meu salário de 1.800 cai dia 5”, “gastei 45 no almoço”. Por texto ou áudio." },
  { n: "3", t: "Veja pra onde vai o dinheiro", d: "Ela separa por categoria, avisa as contas e diz quanto ainda dá pra gastar por dia." },
];

const MUDA = [
  { e: "🔍", t: "Você para de chutar quanto gasta", d: "A Nina soma tudo por categoria. Muita gente descobre que gasta o dobro com comida do que imaginava." },
  { e: "📅", t: "Nenhuma conta esquecida", d: "Aluguel, luz, internet e a fatura do cartão: ela avisa antes de vencer. Acabaram os juros por esquecimento." },
  { e: "🔄", t: "Assinaturas sob controle", d: "Veja quanto paga por mês em streaming e apps, e corte o que não usa." },
  { e: "💡", t: "“Posso gastar?” antes de comprar", d: "A Nina desconta contas, parcelas e assinaturas e diz quanto sobra de verdade." },
  { e: "🐷", t: "Sobra pro porquinho", d: "No fim do mês, a sobra vai para a sua reserva. Pouco a pouco, ela cresce." },
];

const FAQ = [
  { q: "Preciso de cartão para criar a conta?", a: "Não. Você cria a conta grátis e já conversa com a Nina. O cartão só é pedido se você quiser testar o Premium." },
  { q: "Como funciona o teste de 7 dias?", a: `Você cadastra o cartão na página segura do Asaas e usa tudo liberado por 7 dias sem pagar. A primeira cobrança (${brl(PLANS.PREMIUM.priceCents, "BRL")}/mês) só acontece no 8º dia. Se cancelar antes, em Planos, não paga nada.` },
  { q: "Preciso baixar aplicativo?", a: "Não. Funciona no navegador do celular ou do computador e pode ser instalado na tela inicial em menos de 1 minuto." },
  { q: "Meus dados estão seguros?", a: "Sim. A conexão é criptografada, cada pessoa só vê os próprios dados e o cartão é digitado direto no Asaas, sem passar pelo Meu Organiza." },
  { q: "Ganho pouco. Vale a pena?", a: "É justamente quando mais faz diferença: saber pra onde vai cada real é o que separa chegar no fim do mês ou não." },
];

export default function ComecarPage() {
  return (
    <div className="min-h-dvh pb-24 sm:pb-0" style={{ background: C, color: T }}>
      <MetaView name="landing_comecar" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2 font-display text-[18px] font-extrabold"><Sym size={30} />Meu Organiza</span>
        <Link href="/login" className="text-[15px] font-semibold" style={{ color: B }}>Entrar</Link>
      </header>

      {/* gancho */}
      <section style={{ background: N, color: C }}>
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.15fr_1fr] md:py-16">
          <div className="flex flex-col gap-5">
            <span className="w-fit rounded-full px-4 py-1.5 text-[14px] font-bold" style={{ background: Y, color: N }}>Para quem vê o salário sumir</span>
            <h1 className="font-display text-[40px] font-extrabold leading-[1.04] sm:text-[56px]">O salário cai e em <span style={{ color: Y }}>2 semanas some?</span></h1>
            <p className="text-[19px] leading-relaxed" style={{ color: M }}>Fale o que gastou e a <b style={{ color: C }}>Nina</b> organiza: separa por categoria, avisa as contas antes de vencer e diz quanto ainda dá pra gastar.</p>
            <div className="flex flex-col gap-2">
              <Cta />
              <span className="text-[14px]" style={{ color: M }}>Grátis para começar · sem cartão para criar a conta</span>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[36px] border-[6px] shadow-2xl" style={{ borderColor: "#0a0f0d" }}>
            <video src="/videos/nina-salario.mp4" poster="/videos/nina-salario-capa.jpg" autoPlay muted loop playsInline preload="metadata" className="block aspect-[9/16] w-full object-cover" aria-label="A Nina organizando um salário de R$ 1.800 no app" />
          </div>
        </div>
      </section>

      {/* o que muda */}
      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h2 className="font-display text-[30px] font-extrabold leading-tight sm:text-[38px]">O que muda no seu mês</h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {MUDA.map((m) => (
            <div key={m.t} className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="text-[30px]">{m.e}</div>
              <div className="mt-2 text-[18px] font-bold">{m.t}</div>
              <p className="mt-1 text-[15px] leading-relaxed" style={{ color: B }}>{m.d}</p>
            </div>
          ))}
          <div className="flex flex-col justify-center gap-3 rounded-3xl p-5" style={{ background: "#ECEAE3" }}>
            <p className="text-[17px] font-semibold">Café de R$ 8 por dia, um delivery e um app de corrida por semana somam uns <b>R$ 400 por mês</b>.</p>
            <Cta dark>Quero ver os meus gastos</Cta>
          </div>
        </div>
      </section>

      {/* como funciona */}
      <section style={{ background: N, color: C }}>
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
          <h2 className="font-display text-[30px] font-extrabold leading-tight sm:text-[38px]">Começa em 1 minuto</h2>
          <ol className="mt-7 grid gap-4 sm:grid-cols-3">
            {PASSOS.map((p) => (
              <li key={p.n} className="rounded-3xl p-5" style={{ background: "rgba(255,255,255,.07)" }}>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full font-display text-[20px] font-extrabold" style={{ background: Y, color: N }}>{p.n}</span>
                <div className="mt-3 text-[18px] font-bold">{p.t}</div>
                <p className="mt-1 text-[15px] leading-relaxed" style={{ color: M }}>{p.d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8"><Cta /></div>
        </div>
      </section>

      {/* preço */}
      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="text-[15px] font-bold" style={{ color: B }}>Grátis</div>
            <div className="mt-1 font-display text-[34px] font-extrabold">R$ 0</div>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: B }}>Agenda, lembretes, tarefas e lista de compras com a Nina. Sem cartão.</p>
          </div>
          <div className="rounded-3xl p-6 shadow-sm" style={{ background: G, color: C }}>
            <div className="flex items-center gap-2 text-[15px] font-bold"><span style={{ color: Y }}>Premium</span><span className="rounded-full px-2.5 py-0.5 text-[12px]" style={{ background: Y, color: N }}>7 dias grátis</span></div>
            <div className="mt-1 font-display text-[34px] font-extrabold">{brl(PLANS.PREMIUM.priceCents, "BRL")}<span className="text-[17px] font-bold">/mês</span></div>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: M }}>Tudo do Grátis + o financeiro completo: gastos por categoria, contas, cartões, vales, assinaturas e o “Posso gastar?”. Cancele quando quiser.</p>
          </div>
        </div>
      </section>

      {/* dúvidas */}
      <section className="mx-auto max-w-3xl px-4 pb-14 sm:px-6">
        <h2 className="font-display text-[28px] font-extrabold">Dúvidas comuns</h2>
        <div className="mt-5 flex flex-col gap-3">
          {FAQ.map((f) => (
            <details key={f.q} className="rounded-2xl bg-white px-5 py-4 shadow-sm">
              <summary className="cursor-pointer text-[16px] font-bold">{f.q}</summary>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: B }}>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* final */}
      <section className="px-4 pb-16 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-[32px] px-6 py-10 text-center" style={{ background: N, color: C }}>
          <Sym size={56} />
          <p className="font-display text-[28px] font-extrabold leading-tight sm:text-[34px]">Não é o tamanho do salário.<br /><span style={{ color: Y }}>É saber pra onde ele vai.</span></p>
          <Cta />
          <span className="text-[14px]" style={{ color: M }}>Você fala. A Nina organiza.</span>
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-[13px]" style={{ color: B }}>
          <Link href="/privacidade" className="underline">Privacidade</Link> · meuorganiza.com.br
        </p>
      </section>

      {/* botão fixo no celular */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 sm:hidden" style={{ background: "rgba(246,245,240,.96)", borderColor: "#E2E5DF" }}>
        <Cta>Começar grátis</Cta>
      </div>
    </div>
  );
}
