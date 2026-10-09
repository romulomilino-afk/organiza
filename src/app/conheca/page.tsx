import Link from "next/link";
import type { Metadata } from "next";
import { PLANS } from "@/lib/plans";
import { brl } from "@/lib/money";
import { InstallApp } from "@/components/InstallApp";

export const metadata: Metadata = {
  title: "Meu Organiza · Você fala. A gente organiza.",
  description: "Organize seu dinheiro, suas contas, sua agenda e a casa só conversando com a Nina, por texto, áudio ou WhatsApp. Teste grátis por 7 dias.",
};

const G = "#17624F", Y = "#F2C75C", N = "#0F2A22", C = "#F6F5F0", T = "#14231E", B = "#44504B", M = "#C9DBD3";

function Sym({ size = 32, ring = false }: { size?: number; ring?: boolean }) {
  return (
    <span className="inline-flex flex-none items-center justify-center" style={{ width: size, height: size, borderRadius: size * 0.24, background: G, border: ring ? `2px solid ${C}` : undefined }}>
      <span style={{ width: size * 0.37, height: size * 0.37, borderRadius: "50%", background: Y }} />
    </span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <span className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-2xl" style={{ background: G }}>
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke={Y} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
    </span>
  );
}

const BENEFITS = [
  { t: "Dinheiro organizado", p: "Fale o que gastou ou recebeu. A Nina anota, separa por categoria e mostra para onde vai cada real.", d: "M3 7h18v12H3zM3 11h18M7 15h3" },
  { t: "“Posso gastar?”", p: "Antes de comprar, pergunte. A Nina olha contas, fixos e parcelas e responde quanto ainda sobra no mês.", d: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6" },
  { t: "Cartões e parcelas", p: "Cada compra parcelada no lugar certo, com a fatura de cada mês, o limite e o melhor dia de compra.", d: "M3 6h18v12H3zM3 10h18M6 15h4" },
  { t: "Nada passa batido", p: "Contas, prazos e documentos vencendo aparecem no seu dia, com aviso no celular antes de vencer.", d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" },
  { t: "Agenda e lembretes", p: "“Dentista quinta às 15h.” Pronto: está na agenda e a Nina te lembra na hora certa.", d: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" },
  { t: "Casa e compras", p: "Lista do mercado sempre em dia, compras de rotina que voltam sozinhas e a casa toda organizada.", d: "M3 4h2l2.5 11h11L21 8H6.5M9 19h.01M17 19h.01" },
  { t: "A família junta", p: "Até 5 pessoas dividindo lista de compras, agenda e, se quiserem, os gastos da casa.", d: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5h8c3 0 6 2 6 5" },
  { t: "Documentos guardados", p: "CNH, comprovantes e garantias guardados com segurança, com aviso antes de vencer.", d: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" },
  { t: "Nina no WhatsApp", p: "Mande mensagem ou áudio para a Nina direto do WhatsApp, sem abrir o app.", d: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" },
];

const PLAN_FEATURES: Record<"FREE" | "PREMIUM" | "FAMILY", string[]> = {
  FREE: ["50 conversas com a Nina por mês", "Agenda e lembretes", "Tarefas", "Lista de compras"],
  PREMIUM: ["Conversas praticamente ilimitadas", "Dinheiro, cartões e “Posso gastar?”", "Falar por áudio", "Documentos e garantias", "Nina no WhatsApp"],
  FAMILY: ["Tudo do Premium", "Até 5 pessoas", "Agenda e compras da família", "Gastos da casa compartilhados (opcional)"],
};

const FAQ = [
  { q: "Preciso baixar alguma coisa?", a: "Não. O Meu Organiza funciona no navegador e pode ser instalado na tela do celular como um aplicativo, em menos de 1 minuto. Ele se atualiza sozinho." },
  { q: "Como funciona o teste grátis?", a: "Ao criar a conta, você usa todas as funções por 7 dias, sem cadastrar cartão. Depois, escolhe se continua no plano Grátis ou assina o Premium ou o Família." },
  { q: "Posso cancelar quando quiser?", a: "Sim. Em Planos, toque em “Cancelar assinatura”. Você continua com acesso até o fim do mês já pago e não há novas cobranças." },
  { q: "Meus dados estão seguros?", a: "Sim. A conexão é criptografada, as senhas são cifradas, os documentos são guardados criptografados e cada pessoa só vê os próprios dados. O cartão é digitado na página segura do Asaas e não passa pelo Meu Organiza." },
  { q: "Funciona no iPhone e no Android?", a: "Nos dois, e também no computador. Basta acessar meuorganiza.com.br." },
  { q: "Preciso saber usar planilha ou app de finanças?", a: "Não. Você fala do seu jeito, como falaria com um amigo, e a Nina organiza tudo." },
];

export default function ConhecaPage() {
  return (
    <div className="min-h-dvh" style={{ background: C, color: T }}>
      {/* topo */}
      <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ background: "rgba(246,245,240,.9)", borderColor: "#E2E5DF" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#topo" className="flex items-center gap-2 whitespace-nowrap font-display text-[17px] font-extrabold sm:text-[19px]" style={{ color: T }}><Sym size={30} />Meu Organiza</a>
          <nav className="hidden items-center gap-7 text-[15px] font-semibold md:flex" style={{ color: B }} aria-label="Seções">
            <a href="#como-funciona">Como funciona</a><a href="#beneficios">Benefícios</a><a href="#planos">Planos</a><a href="#instalar">Instalar</a><a href="#duvidas">Dúvidas</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="whitespace-nowrap rounded-xl px-2 py-2 text-[15px] font-semibold sm:px-3" style={{ color: G }}>Entrar</Link>
            <Link href="/cadastro" className="whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[15px] font-bold sm:px-4" style={{ background: G, color: C }}><span className="sm:hidden">Testar grátis</span><span className="hidden sm:inline">Começar grátis</span></Link>
          </div>
        </div>
      </header>

      <main id="topo">
        {/* hero */}
        <section className="relative overflow-hidden" style={{ background: N, color: C }}>
          <div className="pointer-events-none absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full opacity-50" style={{ background: G }} />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.1fr_.9fr] md:py-24">
            <div className="flex flex-col gap-6">
              <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: Y }}>Seu assistente pessoal com IA</p>
              <h1 className="font-display text-[44px] font-extrabold leading-[1.02] sm:text-[64px]">Você fala.<br /><span style={{ color: Y }}>A gente organiza.</span></h1>
              <p className="max-w-xl text-[19px] leading-relaxed" style={{ color: M }}>Conte para a Nina o que gastou, o que precisa pagar e o que tem para fazer. Ela organiza seu dinheiro, suas contas e seu dia, por texto, áudio ou WhatsApp.</p>
              <div className="flex flex-wrap gap-3">
                <Link href="/cadastro" className="rounded-2xl px-7 py-4 text-[17px] font-bold" style={{ background: Y, color: N }}>Testar 7 dias grátis</Link>
                <a href="#como-funciona" className="rounded-2xl border px-7 py-4 text-[17px] font-semibold" style={{ borderColor: "rgba(246,245,240,.35)", color: C }}>Ver como funciona</a>
              </div>
              <p className="text-[14px]" style={{ color: M }}>Sem cartão para testar · Cancele quando quiser</p>
            </div>
            {/* celular */}
            <div className="mx-auto w-full max-w-[340px]">
              <div className="rounded-[44px] p-2.5 shadow-2xl" style={{ background: "#08201A" }}>
                <div className="flex flex-col gap-3 rounded-[36px] p-5" style={{ background: C, color: T }}>
                  <div className="flex items-center gap-2.5 border-b pb-3 font-display text-[17px] font-extrabold" style={{ borderColor: "#E2E5DF" }}><Sym size={28} />Nina</div>
                  <p className="ml-auto max-w-[85%] rounded-[22px_22px_6px_22px] px-4 py-3 text-[15px]" style={{ background: G, color: C }}>Gastei 45 no almoço</p>
                  <p className="max-w-[90%] rounded-[22px_22px_22px_6px] border bg-white px-4 py-3 text-[14px] leading-snug" style={{ borderColor: "#E2E5DF" }}><b className="font-display text-[16px]">R$ 45,00 · Almoço</b><br /><span style={{ color: B }}>Anotado em Alimentação ✓</span></p>
                  <p className="ml-auto max-w-[85%] rounded-[22px_22px_6px_22px] px-4 py-3 text-[15px]" style={{ background: G, color: C }}>Posso gastar 300 numa jaqueta?</p>
                  <p className="max-w-[90%] rounded-[22px_22px_22px_6px] border bg-white px-4 py-3 text-[14px] leading-snug" style={{ borderColor: "#E2E5DF" }}><b className="font-display text-[16px]" style={{ color: G }}>Pode, sim!</b><br /><span style={{ color: B }}>Ainda sobram</span> <b>R$ 630</b> <span style={{ color: B }}>este mês.</span></p>
                  <p className="ml-auto max-w-[85%] rounded-[22px_22px_6px_22px] px-4 py-3 text-[15px]" style={{ background: G, color: C }}>Dentista quinta às 15h</p>
                  <p className="max-w-[90%] rounded-[22px_22px_22px_6px] border bg-white px-4 py-3 text-[14px] leading-snug" style={{ borderColor: "#E2E5DF" }}><b className="font-display text-[16px]">Quinta · 15h</b><br /><span style={{ color: B }}>Na agenda. Eu te lembro ✓</span></p>
                </div>
              </div>
              <p className="mt-3 text-center text-[12px]" style={{ color: M }}>Exemplo ilustrativo</p>
            </div>
          </div>
        </section>

        {/* como funciona */}
        <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: G }}>Como funciona</p>
          <h2 className="mt-2 font-display text-[36px] font-extrabold leading-tight sm:text-[46px]">Simples como mandar uma mensagem.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { n: "1", t: "Você fala ou escreve", p: "Do seu jeito: “paguei a luz, 180 reais”, “comprar leite”, “reunião amanhã às 9h”." },
              { n: "2", t: "A Nina organiza", p: "Ela entende, registra no lugar certo e separa por categoria, sem você preencher nada." },
              { n: "3", t: "Você fica em dia", p: "Vê tudo numa tela só e recebe aviso antes de vencer conta, prazo ou compromisso." },
            ].map((s) => (
              <div key={s.n} className="rounded-3xl border bg-white p-7" style={{ borderColor: "#E2E5DF" }}>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full font-display text-[22px] font-extrabold" style={{ background: Y, color: N }}>{s.n}</span>
                <h3 className="mt-4 font-display text-[22px] font-bold">{s.t}</h3>
                <p className="mt-2 text-[16px] leading-relaxed" style={{ color: B }}>{s.p}</p>
              </div>
            ))}
          </div>
        </section>

        {/* benefícios */}
        <section id="beneficios" className="scroll-mt-20 py-20" style={{ background: "#ECEAE3" }}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: G }}>Benefícios</p>
            <h2 className="mt-2 font-display text-[36px] font-extrabold leading-tight sm:text-[46px]">Uma vida. Um app.</h2>
            <p className="mt-3 max-w-2xl text-[18px] leading-relaxed" style={{ color: B }}>Tudo o que costuma ficar espalhado em bloco de notas, planilha e na cabeça, agora num lugar só.</p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {BENEFITS.map((b) => (
                <div key={b.t} className="flex flex-col gap-3 rounded-3xl bg-white p-6">
                  <Icon d={b.d} />
                  <h3 className="font-display text-[21px] font-bold">{b.t}</h3>
                  <p className="text-[16px] leading-relaxed" style={{ color: B }}>{b.p}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* destaque financeiro */}
        <section style={{ background: N, color: C }}>
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-2">
            <div>
              <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: Y }}>Organização financeira</p>
              <h2 className="mt-2 font-display text-[36px] font-extrabold leading-tight sm:text-[46px]">Seu dinheiro em <span style={{ color: Y }}>5 passos</span>, sem planilha.</h2>
              <p className="mt-4 text-[18px] leading-relaxed" style={{ color: M }}>Funciona em real, dólar ou euro, com conversão pela cotação do dia.</p>
            </div>
            <ol className="flex flex-col gap-3">
              {["Fale o que entrou e o que saiu", "Contas fixas lançadas sozinhas todo mês", "Tudo separado nas suas categorias", "Cartões, faturas e parcelas sob controle", "Pergunte “posso gastar?” antes de comprar"].map((t, i) => (
                <li key={t} className="flex items-center gap-4 rounded-2xl px-5 py-4 text-[17px] font-semibold" style={{ background: i === 4 ? Y : G, color: i === 4 ? N : C }}>
                  <span className="font-display text-[24px] font-extrabold" style={{ color: i === 4 ? N : Y }}>{i + 1}</span>{t}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* planos */}
        <section id="planos" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: G }}>Planos</p>
          <h2 className="mt-2 font-display text-[36px] font-extrabold leading-tight sm:text-[46px]">Comece com 7 dias grátis.</h2>
          <p className="mt-3 max-w-2xl text-[18px] leading-relaxed" style={{ color: B }}>Todas as funções liberadas no teste, sem cadastrar cartão. Depois, escolha o plano que combina com você.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {(["FREE", "PREMIUM", "FAMILY"] as const).map((p) => {
              const hot = p === "PREMIUM";
              return (
                <div key={p} className="flex flex-col gap-5 rounded-3xl p-7" style={{ background: hot ? N : "#fff", color: hot ? C : T, border: hot ? "none" : "1px solid #E2E5DF" }}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-[24px] font-bold">{PLANS[p].name}</h3>
                    {hot && <span className="rounded-full px-3 py-1 text-[13px] font-bold" style={{ background: Y, color: N }}>Recomendado</span>}
                  </div>
                  <p className="font-display text-[40px] font-extrabold leading-none">{PLANS[p].priceCents ? brl(PLANS[p].priceCents, "BRL") : "R$ 0"}<span className="text-[16px] font-semibold" style={{ color: hot ? M : B }}>{PLANS[p].priceCents ? "/mês" : " para sempre"}</span></p>
                  <ul className="flex flex-col gap-2 text-[16px]">
                    {PLAN_FEATURES[p].map((f) => <li key={f} className="flex gap-2"><span style={{ color: hot ? Y : G }}>✓</span>{f}</li>)}
                  </ul>
                  <Link href="/cadastro" className="mt-auto rounded-2xl px-5 py-3.5 text-center text-[16px] font-bold" style={{ background: hot ? Y : G, color: hot ? N : C }}>Começar grátis</Link>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-[14px]" style={{ color: B }}>Pagamento por cartão de crédito com cobrança automática mensal, pelo Asaas. Cancele quando quiser.</p>
        </section>

        {/* instalar */}
        <section id="instalar" className="scroll-mt-20" style={{ background: N, color: C }}>
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1fr_1fr]">
            <div className="flex flex-col gap-5">
              <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: Y }}>Baixe o app</p>
              <h2 className="font-display text-[36px] font-extrabold leading-tight sm:text-[46px]">No seu celular, como um aplicativo.</h2>
              <p className="text-[18px] leading-relaxed" style={{ color: M }}>Sem passar pela loja: o Meu Organiza vai direto para a tela do celular, abre em tela cheia, ocupa quase nada de memória e se atualiza sozinho.</p>
              <InstallApp />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl p-6" style={{ background: G }}>
                <h3 className="font-display text-[22px] font-bold">Android</h3>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[16px] leading-snug" style={{ color: M }}>
                  <li>Abra <b style={{ color: C }}>meuorganiza.com.br</b> no Chrome</li>
                  <li>Toque nos três pontinhos <b style={{ color: C }}>⋮</b></li>
                  <li>Toque em <b style={{ color: C }}>Instalar app</b></li>
                  <li>Confirme em <b style={{ color: C }}>Instalar</b></li>
                </ol>
              </div>
              <div className="rounded-3xl p-6" style={{ background: G }}>
                <h3 className="font-display text-[22px] font-bold">iPhone</h3>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[16px] leading-snug" style={{ color: M }}>
                  <li>Abra <b style={{ color: C }}>meuorganiza.com.br</b> no Safari</li>
                  <li>Toque em <b style={{ color: C }}>Compartilhar</b></li>
                  <li>Toque em <b style={{ color: C }}>Adicionar à Tela de Início</b></li>
                  <li>Confirme em <b style={{ color: C }}>Adicionar</b></li>
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* segurança */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid items-center gap-8 rounded-[32px] bg-white p-8 sm:p-12 md:grid-cols-[1fr_1.2fr]" style={{ border: "1px solid #E2E5DF" }}>
            <div>
              <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: G }}>Segurança</p>
              <h2 className="mt-2 font-display text-[32px] font-extrabold leading-tight sm:text-[40px]">Seus dados, bem guardados.</h2>
            </div>
            <ul className="grid gap-3 text-[16px] sm:grid-cols-2" style={{ color: B }}>
              {["Conexão sempre criptografada", "Senhas cifradas", "Documentos guardados criptografados", "Cada pessoa só vê os próprios dados", "Cartão digitado só na página do Asaas", "De acordo com a LGPD"].map((t) => (
                <li key={t} className="flex items-start gap-2"><span className="font-bold" style={{ color: G }}>✓</span>{t}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* dúvidas */}
        <section id="duvidas" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-20 sm:px-6">
          <p className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: G }}>Dúvidas</p>
          <h2 className="mt-2 font-display text-[36px] font-extrabold leading-tight sm:text-[46px]">Perguntas frequentes</h2>
          <div className="mt-8 flex flex-col gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-white px-6 py-5" style={{ border: "1px solid #E2E5DF" }}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[18px] font-bold">{f.q}<span className="text-[22px] transition group-open:rotate-45" style={{ color: G }}>+</span></summary>
                <p className="mt-3 text-[16px] leading-relaxed" style={{ color: B }}>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* chamada final */}
        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 rounded-[36px] px-6 py-16 text-center" style={{ background: N, color: C }}>
            <Sym size={72} ring />
            <h2 className="font-display text-[34px] font-extrabold leading-tight sm:text-[48px]">Comece hoje a organizar<br /><span style={{ color: Y }}>sem esforço.</span></h2>
            <p className="max-w-xl text-[18px]" style={{ color: M }}>7 dias grátis com tudo liberado. Sem cartão para testar.</p>
            <Link href="/cadastro" className="rounded-2xl px-8 py-4 text-[18px] font-bold" style={{ background: Y, color: N }}>Criar minha conta grátis</Link>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: "#E2E5DF" }}>
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 text-[14px] sm:flex-row sm:items-center sm:px-6" style={{ color: B }}>
          <span className="flex items-center gap-2 font-display font-extrabold" style={{ color: T }}><Sym size={22} />Meu Organiza</span>
          <nav className="flex flex-wrap gap-5" aria-label="Rodapé">
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/excluir-conta">Excluir conta</Link>
            <Link href="/login">Entrar</Link>
          </nav>
          <span>© {new Date().getFullYear()} Meu Organiza</span>
        </div>
      </footer>
    </div>
  );
}
