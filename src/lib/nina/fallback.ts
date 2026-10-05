/**
 * Interpretador por regras — usado quando não há chave de IA configurada ou a IA falha.
 * Cobre os casos mais comuns do dia a dia. A IA (llm.ts) cobre o resto.
 * Função pura: facilita testes.
 */
import { addDays, dateInMonth, addMonths, weekday, cap, relDay, fmtBR, MESES } from "../dates";
import { firstDueDate } from "../cards";
import { parseMonthDate } from "../watch";
import { explainFree, explainSimulation, type Budget } from "../budget";
import { brl, toCents } from "../money";

type Out = { reply: string; actions: Record<string, unknown>[]; suggestion?: Record<string, unknown> | null };

const pad = (n: number) => String(n).padStart(2, "0");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function parseDate(text: string, today: string): string | null {
  const s = norm(text);
  if (/depois de amanha/.test(s)) return addDays(today, 2);
  if (/amanha/.test(s)) return addDays(today, 1);
  if (/\bhoje\b/.test(s)) return today;
  let m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
    let d = `${y}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    if (!m[3] && d < today) d = `${y + 1}${d.slice(4)}`;
    return d;
  }
  m = s.match(/\bdia (\d{1,2})\b/);
  if (m) {
    let d = dateInMonth(today, Number(m[1]));
    if (d < today) d = dateInMonth(addMonths(today.slice(0, 8) + "01", 1), Number(m[1]));
    return d;
  }
  const names = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${names[i]}`).test(s)) {
      const n = (i - weekday(today) + 7) % 7;
      return addDays(today, /semana que vem|proxima semana/.test(s) && n === 0 ? 7 : n);
    }
  }
  return null;
}

export function parseTime(text: string): string | null {
  const s = norm(text);
  let m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m && Number(m[1]) < 24) return `${pad(Number(m[1]))}:${m[2]}`;
  m = s.match(/\b(\d{1,2})\s*h\s*(\d{2})?\b/) || s.match(/\bas (\d{1,2})(?:\s*horas?)?\b/);
  if (m) {
    let h = Number(m[1]);
    if (h > 23) return null;
    if (/da tarde|da noite/.test(s) && h < 12) h += 12;
    return `${pad(h)}:${pad(Number(m[2] ?? 0))}`;
  }
  return null;
}

export function parseMoney(text: string): number | null {
  const s = text.toLowerCase().replace(/(\d)\.(\d{3})/g, "$1$2");
  const m = s.match(/r\$\s*(\d+(?:,\d{1,2})?)/) || s.match(/(\d+(?:,\d{1,2})?)\s*(?:reais|real|conto|pila)/) || s.match(/\bpor\s+(\d+(?:[.,]\d{1,2})?)\b/)
    || s.match(/\b(?:gastei|paguei|recebi|ganhei)\s+(\d+(?:[.,]\d{1,2})?)\b/);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  return v > 0 ? v : null;
}

export function guessCategory(text: string): string {
  const s = norm(text);
  const map: [string, RegExp][] = [
    ["alimentacao", /mercado|almoco|jantar|lanche|restaurante|padaria|ifood|cafe|pizza|comida|acougue|feira|hortifruti/],
    ["transporte", /uber|\b99\b|gasolina|combust|onibus|metro|estacionamento|oficina|pedagio/],
    ["saude", /farmacia|remedio|medico|dentista|exame|consulta|hospital|academia|plano de saude/],
    ["assinaturas", /netflix|spotify|assinatura|prime video|disney|youtube premium/],
    ["casa", /\bluz\b|energia|\bagua\b|internet|aluguel|condominio|\bgas\b|faxina|diarista|racao|pet\b|veterinari/],
    ["educacao", /escola|curso|faculdade|livro|mensalidade/],
    ["lazer", /cinema|show|\bbar\b|viagem|passeio|ingresso|festa/],
    ["compras", /roupa|tenis|camisa|calca|sapato|presente|loja|celular|fone|ar-condicionado|geladeira|tv\b|televis|notebook|computador|tablet|monitor|impressora|sofa|cama|colchao|armario|mesa|cadeira|maquina de lavar|fogao|micro-?ondas|eletro|movel|moveis/],
  ];
  for (const [k, re] of map) if (re.test(s)) return k;
  return "outros";
}

const CAT_NAME: Record<string, string> = { alimentacao: "Alimentação", transporte: "Transporte", saude: "Saúde", assinaturas: "Assinaturas", casa: "Casa", educacao: "Educação", lazer: "Lazer", compras: "Compras", outros: "Outros" };
const APPOINTMENT = /(medic[oa]|dentista|reuniao|consulta|exame|oficina|cabeleireir[oa]|pediatra|entrevista|futebol|aula|academia|aniversario|veterinario)/;

function stripDateWords(s: string) {
  // \b não entende acentos ("amanhã"), então usamos limites por espaço/pontuação
  return s.replace(/(?<=^|[\s,])(amanh[ãa]|hoje|depois de amanh[ãa]|dia \d{1,2}|\d{1,2}\/\d{1,2}(\/\d{2,4})?|(à|a)s?\s*\d{1,2}(h\d{0,2}|:\d{2})?|\d{1,2}h\d{0,2}|(na |no )?(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)(-feira)?)(?=$|[\s,.!?])/gi, "")
    .replace(/\s{2,}/g, " ").trim();
}

type UserCat = { key: string; name: string; kind: "EXPENSE" | "INCOME"; keywords: string[] };
/** Categorias da pessoa durante a interpretação (a função é síncrona, então não há mistura entre usuários). */
let userCats: UserCat[] = [];
type UserCard = { name: string; closingDay: number; dueDay: number; limitCents?: number | null; usedCents?: number };
let userCardsList: UserCard[] = [];
function matchUserCat(s: string, kind: "EXPENSE" | "INCOME"): UserCat | null {
  let best: { c: UserCat; n: number } | null = null;
  for (const c of userCats) if (c.kind === kind) for (const k of c.keywords) {
    const kw = norm(k);
    if (kw.length >= 3 && s.includes(kw) && (!best || kw.length > best.n)) best = { c, n: kw.length };
  }
  return best?.c ?? null;
}
const catName = (key: string) => userCats.find((c) => c.key === key)?.name ?? CAT_NAME[key] ?? "Outros";

export function fallbackNina(text: string, today: string, history: { lastUser?: string; lastAssistant?: string } = {},
  opts: { family?: boolean; categories?: UserCat[]; cards?: UserCard[]; budget?: Budget | null; financeEnabled?: boolean } = {}): Out {
  const sN = norm(text);
  // "Posso gastar?" — pergunta respondida com o orçamento do mês
  if (/\b(posso|consigo|da pra|da para)\b.{0,30}\b(gastar|comprar)\b|quanto (eu )?posso gastar|quanto (da|sobra) (pra|para) gastar/.test(sN)) {
    if (opts.financeEnabled === false) return { reply: "O “Posso gastar?” faz parte do plano Premium: eu analiso renda, contas, fixos, cartão e assinaturas para te dizer quanto sobra. 💡", actions: [] };
    if (opts.budget) {
      const m = purchaseMoney(text);
      const n = Number(sN.match(/\b(\d{1,2})\s*(?:x|vezes|parcelas)\b/)?.[1] ?? 1);
      const total = m.total ?? (m.each ? m.each * n : null);
      if (total && /\b(comprar|gastar)\b.{0,60}\d/.test(sN)) return { reply: explainSimulation(opts.budget, toCents(total), n), actions: [] };
      return { reply: explainFree(opts.budget), actions: [] };
    }
  }
  userCats = opts.categories ?? [];
  userCardsList = opts.cards ?? [];
  let out: Out;
  try { out = fallbackCore(text, today, history); } finally { userCats = []; userCardsList = []; }
  // na família: "a gente", "família", "casa", "nós"… compartilha compromissos e tarefas
  if (opts.family && /\b(familia|família|a gente|nós|nos vamos|compartilh|todo mundo|lá em casa)\b/i.test(text)) {
    for (const a of out.actions) if (a.type === "add_event" || a.type === "add_task") a.shared = true;
  }
  return out;
}

function fallbackCore(text: string, today: string, history: { lastUser?: string; lastAssistant?: string } = {}): Out {
  const raw = text.trim();
  const s = norm(raw);

  if (history.lastAssistant && history.lastUser && /(qual dia a fatura .*fecha|qual dia vence a fatura)/.test(norm(history.lastAssistant))) {
    const n = s.match(/\b(\d{1,2})\b/);
    const word = /fecha/.test(norm(history.lastAssistant)) ? "fecha" : "vence";
    if (n) return fallbackCore(`${history.lastUser} ${word} dia ${n[1]}`, today);
  }
  if (history.lastAssistant && history.lastUser && /em qual cartao/.test(norm(history.lastAssistant))) {
    const c = findCard(s);
    if (c) return fallbackCore(`${history.lastUser} no ${c.name}`, today);
  }
  // resposta a uma pergunta de horário/dia feita antes
  if (history.lastAssistant && history.lastUser && /qual (horario|dia)/.test(norm(history.lastAssistant))) {
    const t = parseTime(raw) ?? (/^\d{1,2}$/.test(s) ? `${pad(Number(s))}:00` : null);
    const d = parseDate(raw, today);
    if (t || d) return fallbackCore(`${history.lastUser} ${d ? raw : ""} ${t ? `às ${t}` : ""}`.trim(), today);
  }
  if (history.lastAssistant && history.lastUser && /qual dia do mes/.test(norm(history.lastAssistant))) {
    const n = s.match(/\b(\d{1,2})\b/);
    if (n && Number(n[1]) >= 1 && Number(n[1]) <= 31) return fallbackCore(`${history.lastUser} todo dia ${n[1]}`, today);
  }
  if (history.lastAssistant && history.lastUser && /qual (foi )?o valor|qual conta/.test(norm(history.lastAssistant))) {
    const v = parseMoney(raw) ?? (/^\d+([.,]\d{1,2})?$/.test(s) ? Number(s.replace(",", ".")) : null);
    if (v) return fallbackCore(`${history.lastUser} ${v} reais ${raw}`, today);
  }

  // várias coisas numa frase: "Amanhã tenho médico às 15h e depois passar no mercado. Também preciso pagar a luz sexta."
  const clauses = raw.split(/(?<=[.!?;])\s+|\s+(?:e depois|depois|e também|também|tambem)\s+/i).map((c) => c.trim().replace(/^(e|depois)\s+/i, "")).filter((c) => c.length > 2);
  if (clauses.length < 2) return parseClause(raw, today, history);

  const out: Out = { reply: "", actions: [], suggestion: null };
  const replies: string[] = [];
  let inherited: string | null = null;
  let eventsSoFar = 0;
  for (const c of clauses) {
    const own = parseDate(c, today);
    let r = parseClause(c, today, history);
    const understood = r.actions.length > 0 || /\?$/.test(r.reply);
    if (!understood && c.split(/\s+/).length <= 8) {
      // pedaço sem verbo-chave ("passar no mercado"): vira tarefa, herdando o dia anterior
      r = { reply: "", actions: [{ type: "add_task", title: cap(stripDateWords(c).replace(/[.!]$/, "")), due: own ?? inherited ?? undefined }] };
    } else if (!own && inherited) {
      for (const a of r.actions) if (a.type === "add_task" && !a.due) a.due = inherited;
    }
    if (own) inherited = own;
    if (r.suggestion && !out.suggestion && eventsSoFar === 0 && r.actions.some((a) => a.type === "add_event")) out.suggestion = r.suggestion;
    eventsSoFar += r.actions.filter((a) => a.type === "add_event").length;
    out.actions.push(...r.actions);
    if (r.actions.length === 0 && r.reply) replies.push(r.reply);
  }
  const n = out.actions.filter((a) => a.type !== "remember").length;
  out.reply = [n ? `Pronto! Organizei ${n} ${n === 1 ? "item" : "itens"} para você. 👍` : "", ...replies].filter(Boolean).join(" ");
  return out;
}

const PROBLEM = /(barulh|quebr|vazand|vazamento|pingando|entupi|nao (esta |ta |tá )?funcionando|nao funciona|parou de funcionar|estragou|estragad|com defeito|pifou|nao liga|nao esquenta|nao gela|esquentando demais|rachad|trincad|goteira|infiltra|mofo|curto|desregulad|falhando)/;
const DEADLINE_ITEMS: [RegExp, string, string, number | null][] = [
  [/seguro (do |da )?(carro|auto|moto)|seguro auto/, "Seguro do carro", "seguro", 12],
  [/seguro (de |da )?(casa|residencia|residencial)/, "Seguro da casa", "seguro", 12],
  [/seguro (de |da )?vida/, "Seguro de vida", "seguro", 12],
  [/\bseguro\b/, "Seguro", "seguro", 12],
  [/\bcnh\b|carteira de motorista|habilitacao/, "CNH", "documento", null],
  [/passaporte/, "Passaporte", "documento", null],
  [/\brg\b|identidade/, "RG", "documento", null],
  [/\bipva\b/, "IPVA", "imposto", 12],
  [/\biptu\b/, "IPTU", "imposto", 12],
  [/licenciamento/, "Licenciamento do carro", "imposto", 12],
  [/contrato (do |de )?aluguel/, "Contrato do aluguel", "contrato", null],
  [/\bcontrato\b/, "Contrato", "contrato", null],
  [/revisao (do |da )?(carro|moto)/, "Revisão do carro", "revisao", null],
  [/vistoria/, "Vistoria", "revisao", null],
  [/plano de saude|convenio/, "Plano de saúde", "contrato", 12],
  [/vacina/, "Vacina", "outro", null],
  [/dominio|certificado digital/, "Certificado/domínio", "documento", 12],
];
const ROUTINE = /(quando (estiver|tiver|for|ta|tá|esta) (acabando|no fim|terminando)|toda semana|todo mes|todos os meses|toda quinzena|a cada (\d+) (dias|semanas)|de (\d+) em \d+ dias|sempre que acabar)/;

function parseWatch(raw: string, s: string, today: string): Out | null {
  // compra de rotina: "preciso comprar ração quando estiver acabando", "compro café toda semana"
  if (ROUTINE.test(s) && /\b(comprar|compro|repor|reponho|acaba|acabar)\b/.test(s)) {
    const item = raw.match(/(?:comprar|compro|repor|reponho)\s+(?:mais\s+)?(?:o\s+|a\s+|os\s+|as\s+)?(.+?)(?=\s+(?:quando|toda|todo|todos|a cada|de \d+|sempre)\b|[,.!]|$)/i)?.[1]
      ?? raw.match(/^(?:a\s+|o\s+)?(.+?)\s+(?:acaba|termina)/i)?.[1];
    if (!item) return null;
    const every = /toda semana/.test(s) ? 7 : /quinzena/.test(s) ? 15 : (() => {
      const m = s.match(/a cada (\d+) (dias|semanas)/) ?? s.match(/de (\d+) em \d+ dias/);
      return m ? Number(m[1]) * (m[2] === "semanas" ? 7 : 1) : 30;
    })();
    const name = cap(item.replace(/^(de|do|da)\s+/i, "").trim());
    const addNow = /(acabando|no fim|terminando|acabou)/.test(s) && !/quando/.test(s);
    return { reply: `Combinado! Vou colocar ${name.toLowerCase()} na lista de compras a cada ~${every} dias${addNow ? " (e já coloquei agora)" : ""}. Quando você marcar como comprado, recomeço a contagem. 🔁`,
      actions: [{ type: "add_shopping_routine", item: name, everyDays: every, addNow }] };
  }
  // garantia na mesma frase: "comprei uma televisão hoje, a garantia é de 12 meses"
  const war = s.match(/garantia (?:e |eh |é |de |dura )*(?:de )?(\d+)\s*(ano|anos|mes|meses)/) ?? s.match(/(\d+)\s*(ano|anos|mes|meses) de garantia/);
  if (war && /\bcomprei\b/.test(s)) {
    const months = Number(war[1]) * (war[2].startsWith("ano") ? 12 : 1);
    const item = raw.match(/comprei\s+(?:um\s+|uma\s+|o\s+|a\s+)?([A-Za-zÀ-ú\- ]{3,40}?)(?=\s+(?:hoje|ontem|por|de r\$|de \d|no|na|e a|,)|[,.]|$)/i)?.[1]?.trim();
    if (!item) return null;
    const date = /\bontem\b/.test(s) ? addDays(today, -1) : today;
    const until = addMonths(date, months);
    const actions: Out["actions"] = [{ type: "add_warranty", item: cap(item), months, purchaseDate: date }];
    const val = purchaseMoney(raw.replace(/(\d+)\s*(ano|anos|m[eê]s|meses)/gi, "")).total;
    if (val && val > 1) actions.push({ type: "add_transaction", kind: "expense", amount: val, category: guessCategory(s), description: cap(item), date });
    return { reply: `Anotado! ${cap(item)} com garantia até ${MESES[Number(until.slice(5, 7)) - 1]}/${until.slice(0, 4)}. Te aviso 30 dias antes. Guarde a nota fiscal em Casa → Documentos. 🧾`, actions };
  }
  // problema: "minha geladeira está fazendo um barulho estranho"
  if (PROBLEM.test(s) && !/\b(comprei|gastei|paguei)\b/.test(s)) {
    const om = raw.match(/\b(meu|minha|o|a|nosso|nossa)\s+([A-Za-zÀ-ú\-]+(?:\s+(?:de|do|da)\s+[A-Za-zÀ-ú]+)?)/i);
    const thing = om && !/^(casa|gente|vez|noite|dia)$/i.test(om[2]) ? om[2].toLowerCase() : null;
    const art = om && /^(minha|a|nossa)$/i.test(om[1]) ? "a" : "o";
    const title = thing ? `Chamar alguém para ver ${art} ${thing}` : `Resolver: ${raw.replace(/[.!]+$/, "").slice(0, 80)}`;
    const tomorrow = addDays(today, 1);
    return {
      reply: `Poxa${thing ? `, ${thing} com problema é chato` : ""}! Anotei para não passar. 📝`,
      actions: [],
      suggestion: { text: "Quer que eu crie uma tarefa para amanhã às 10h?", yes: "Sim, criar", no: "Agora não", action: { type: "add_task", title: cap(title.trim()), due: tomorrow, time: "10:00" } },
    };
  }
  // vencimento/renovação: "meu seguro vence em dezembro", "a CNH vence dia 20 de março de 2027"
  if (/\b(vence|vencimento|renov|expira|termina|acaba)\w*/.test(s) && !/\b(conta de|boleto|fatura|cartao)\b/.test(s)) {
    const hit = DEADLINE_ITEMS.find(([re]) => re.test(s));
    if (!hit) return null;
    const md = parseMonthDate(raw, today) ?? (() => { const d = parseDate(raw, today); return d ? { date: d, exactDay: true } : null; })();
    // "preciso renovar minha CNH" (sem data) é uma tarefa, não um vencimento
    if (!md && /\b(preciso|tenho que|vou)\b/.test(s)) return null;
    if (!md) return { reply: `Quando vence: ${hit[1]}? Pode ser só o mês, ex.: “em dezembro”.`, actions: [] };
    const [, name, kind, renew] = hit;
    const remind = 30;
    const from = addDays(md.date, -remind);
    return {
      reply: `Anotado! ${name} vence em ${md.exactDay ? fmtBR(md.date) : `${MESES[Number(md.date.slice(5, 7)) - 1]}/${md.date.slice(0, 4)}`}. Te aviso ${from <= today ? "desde já" : `a partir de ${fmtBR(from)}`} (30 dias antes).${md.exactDay ? "" : " Se souber o dia exato, me fala."} 📌`,
      actions: [{ type: "add_deadline", name, date: md.date, remindDaysBefore: remind, renewMonths: renew ?? undefined, kind }],
    };
  }
  return null;
}

const BANKS = /\b(nubank|nu|inter|itau|bradesco|santander|caixa|c6|bb|banco do brasil|next|picpay|mercado pago|neon|original|pan|xp|porto( seguro)?|carrefour|riachuelo|renner|sicredi|sicoob|will|ourocard|elo|visa|mastercard|amex|digio|btg|credicard|hipercard|magalu|americanas)\b/;
function findCard(s: string): UserCard | null {
  return userCardsList.find((c) => new RegExp(`\\b${norm(c.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s)) ?? null;
}
/** Valor da compra ignorando "10x", "dia 5" e "fecha/vence dia N". */
function purchaseMoney(raw: string): { total?: number; each?: number } {
  const t = raw.toLowerCase().replace(/(\d)\.(\d{3})/g, "$1$2");
  const each = t.match(/(\d{1,2})\s*(?:x|vezes|parcelas)\s*de\s*(?:r\$\s*)?(\d+(?:,\d{1,2})?)/);
  if (each) return { each: Number(each[2].replace(",", ".")) };
  const clean = t.replace(/(\d{1,2})\s*(?:x|vezes|parcelas)\b/g, " ").replace(/\bdia\s+\d{1,2}\b/g, " ").replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  const m = clean.match(/r\$\s*(\d+(?:,\d{1,2})?)/) ?? clean.match(/\b(\d+(?:,\d{1,2})?)\b/);
  return m ? { total: Number(m[1].replace(",", ".")) } : {};
}

function parseCard(raw: string, s: string, today: string): Out | null {
  // pergunta: melhor dia de compra
  if (/melhor dia (de|pra|para) (compra|comprar)/.test(s)) {
    if (!userCardsList.length) return { reply: "Me fala seu cartão primeiro, ex.: “meu Nubank fecha dia 3 e vence dia 10”. Aí te digo o melhor dia. 💳", actions: [] };
    return { reply: userCardsList.map((c) => `${c.name}: melhor dia de compra é dia ${c.closingDay} (fecha dia ${c.closingDay}, vence dia ${c.dueDay}).`).join(" ") + " Comprando nesse dia, a compra vai para a fatura seguinte. 💳", actions: [] };
  }
  // limite: "o limite do Nubank agora é 8.000", "qual meu limite?"
  if (/\blimite\b/.test(s) && userCardsList.length && !/\bfecha(mento)?\b/.test(s)) {
    const c = findCard(s) ?? (userCardsList.length === 1 ? userCardsList[0] : null);
    const v = s.replace(/(\d)\.(\d{3})/g, "$1$2").match(/(?:r\$\s*)?(\d+(?:,\d{1,2})?)/)?.[1];
    if (v) {
      if (!c) return { reply: `De qual cartão? ${userCardsList.map((x) => x.name).join(" ou ")}?`, actions: [] };
      const limit = Number(v.replace(",", "."));
      return { reply: `Pronto, o limite do ${c.name} agora é ${brl(toCents(limit))}. 💳`, actions: [{ type: "update_card", card: c.name, limit }] };
    }
    const list = c ? [c] : userCardsList;
    return { reply: list.map((x) => x.limitCents
      ? `${x.name}: limite ${brl(x.limitCents)}, usado ${brl(x.usedCents ?? 0)}, disponível ${brl(Math.max(0, x.limitCents - (x.usedCents ?? 0)))}.`
      : `${x.name}: ainda não sei o limite. Diga “o limite do ${x.name} é 5.000”.`).join(" ") + " 💳", actions: [] };
  }
  // pagar a fatura
  if (/(paguei|pagar|quitei|ja paguei) (a |minha )?fatura|paguei o cartao/.test(s)) {
    if (!userCardsList.length) return null;
    const c = findCard(s) ?? (userCardsList.length === 1 ? userCardsList[0] : null);
    if (!c) return { reply: `De qual cartão? ${userCardsList.map((x) => x.name).join(" ou ")}?`, actions: [] };
    return { reply: `Pronto, marquei a fatura do ${c.name} como paga. ✅`, actions: [{ type: "pay_invoice", card: c.name }] };
  }
  // cadastrar cartão: "meu Nubank fecha dia 3 e vence dia 10", "cartão Inter vence dia 15 fecha dia 8 limite 5000"
  const isRegister = (/\bfecha(mento)?\b/.test(s) || (/\bvence(mento)?\b/.test(s) && /\bcartao\b/.test(s))) && !/\b(comprei|gastei|paguei|parcel)/.test(s);
  if (isRegister && (/\bcartao\b/.test(s) || BANKS.test(s))) {
    const bank = s.match(BANKS)?.[0];
    const named = raw.match(/cart[ãa]o\s+(?:do\s+|da\s+)?([A-Za-zÀ-ú0-9]+(?:\s+[A-Z][A-Za-zÀ-ú0-9]+)?)/)?.[1];
    const nameRaw = named && !/^(fecha|vence|de|que|meu|com)$/i.test(named) ? named : bank ?? "Cartão";
    const name = nameRaw === "nu" ? "Nubank" : cap(nameRaw);
    const closing = s.match(/fecha(?:mento)?\s*(?:e\s*)?(?:no\s+|todo\s+)?(?:dia\s+)?(\d{1,2})\b/)?.[1];
    const due = s.match(/vence(?:mento)?\s*(?:e\s*)?(?:no\s+|todo\s+)?(?:dia\s+)?(\d{1,2})\b/)?.[1];
    const lim = s.replace(/(\d)\.(\d{3})/g, "$1$2").match(/limite\s*(?:de\s*)?(?:r\$\s*)?(\d+(?:,\d{1,2})?)/)?.[1];
    if (!closing) return { reply: `Qual dia a fatura do ${name} fecha?`, actions: [] };
    if (!due) return { reply: `Qual dia vence a fatura do ${name}?`, actions: [] };
    const cd = Number(closing), dd = Number(due);
    if (cd < 1 || cd > 31 || dd < 1 || dd > 31) return null;
    return { reply: `Cartão ${name} cadastrado! Fecha dia ${cd}, vence dia ${dd}. Melhor dia de compra: dia ${cd}. 💳`,
      actions: [{ type: "add_card", name, closingDay: cd, dueDay: dd, limit: lim ? Number(lim.replace(",", ".")) : undefined }] };
  }
  // compra no cartão
  const inst = s.match(/\b(\d{1,2})\s*(?:x|vezes|parcelas)\b/);
  const mentionsCard = /\b(no|pelo) (cartao|credito)\b|\bparcel/.test(s) || !!findCard(s);
  const isBuy = /\b(comprei|gastei|paguei|parcelei|passei)\b/.test(s);
  if (isBuy && (inst || mentionsCard)) {
    if (!userCardsList.length) {
      if (!inst) return null; // "gastei 50 no cartão" sem cartão cadastrado: vira despesa comum
      return { reply: "Para eu controlar as parcelas, me diga seu cartão primeiro. Ex.: “meu Nubank fecha dia 3 e vence dia 10”. 💳", actions: [] };
    }
    const card = findCard(s) ?? (userCardsList.length === 1 ? userCardsList[0] : null);
    if (!card) return { reply: `Em qual cartão? ${userCardsList.map((x) => x.name).join(" ou ")}?`, actions: [] };
    const n = inst ? Math.min(48, Math.max(1, Number(inst[1]))) : 1;
    const money = purchaseMoney(raw);
    if (!money.total && !money.each) return { reply: "Qual foi o valor da compra?", actions: [] };
    const desc = raw.replace(/\b(comprei|gastei|paguei|parcelei|passei)\b/i, "").replace(/\b(no|pelo|na)\s+(cart[ãa]o|cr[ée]dito)(\s+de cr[ée]dito)?\b/gi, "")
      .replace(new RegExp(`\\b(no|na|do|da)?\\s*${card.name}\\b`, "i"), "")
      .replace(/\b(em\s+)?\d{1,2}\s*(x|vezes|parcelas)(\s*de\s*(r\$\s*)?[\d.,]+)?/gi, "").replace(/(r\$\s*)?\d+(?:[.,]\d+)*\s*(reais|real)?/gi, "")
      .replace(/\b(hoje|ontem)\b/gi, "").replace(/\s+(de|por|em|com)\s*$/i, "").replace(/^\s*(um|uma|o|a|de|no|na|em)\s+/i, "").replace(/\s+(de|por|em|com)(?=\s|$)/gi, " ").replace(/[.,!]+/g, "").replace(/\s{2,}/g, " ").trim();
    const category = matchUserCat(s, "EXPENSE")?.key ?? guessCategory(s);
    const description = cap(desc || catName(category));
    const total = money.total ?? money.each! * n;
    const each = money.each ?? total / n;
    const date = /\bontem\b/.test(s) ? addDays(today, -1) : today;
    const first = firstDueDate(date, card.closingDay, card.dueDay);
    return { reply: `Lancei ${description} no ${card.name}: ${n > 1 ? `${n}x de ${brl(toCents(each))}` : brl(toCents(total))}. ${n > 1 ? "A 1ª parcela" : "Entra"} na fatura de ${fmtBR(first)}. 💳`,
      actions: [{ type: "add_card_purchase", card: card.name, description, amount: money.total, installmentAmount: money.each, installments: n, category, date }] };
  }
  return null;
}

const EMOJI: [RegExp, string][] = [
  [/barbe|cabel/, "💈"], [/academia|treino|crossfit|pilates/, "🏋️"], [/pet|cachorro|gato|racao|veterin/, "🐶"],
  [/beleza|manicure|unha|salao|estetica/, "💅"], [/bebe|filho|crianca|fralda/, "👶"], [/igreja|dizimo|oferta/, "⛪"],
  [/presente/, "🎁"], [/viage|passage|hotel/, "✈️"], [/mercado|feira/, "🛒"], [/bar\b|cerveja|bebida/, "🍺"],
  [/cafe/, "☕"], [/farmacia|remedio/, "💊"], [/carro|combust|gasolina/, "🚗"], [/moto/, "🏍️"],
  [/investiment|reserva|poupanca/, "📈"], [/freela|bico|venda/, "💼"], [/jogo|game/, "🎮"], [/roupa/, "👕"], [/educa|curso|escola/, "🎓"],
];
const pickEmoji = (t: string) => EMOJI.find(([re]) => re.test(norm(t)))?.[1] ?? "🏷️";
const splitWords = (t: string) => t.split(/,|\s+e\s+|\s+ou\s+|\//i).map((x) => x.trim().replace(/^(o|a|os|as|de|do|da|meu|minha|meus|minhas)\s+/i, "").replace(/[.!?]+$/, "")).filter((x) => x.length >= 3 && x.length <= 40);
const cleanName = (t: string) => t.trim().replace(/^["“']|["”'.!?]+$/g, "").replace(/^(de|da|do|chamada|com nome( de)?)\s+/i, "").trim();

function parseCategory(raw: string, s: string): Out | null {
  if (!/\bcategoria/.test(s)) return null;
  const del = raw.match(/\b(?:apag\w*|exclu\w*|remov\w*|delet\w*|tir\w*)\s+(?:a\s+)?categoria\s+(.+)/i);
  if (del) {
    const name = cleanName(del[1]);
    return { reply: `Pronto, apaguei a categoria ${name}. Os lançamentos dela foram para Outros. 🗑️`, actions: [{ type: "delete_category", name }] };
  }
  const kind = /categoria de (receita|entrada|ganho)/.test(s) ? "income" : "expense";
  const create = raw.match(/\b(?:cri\w*|nova|novo|adicion\w*|faz\w*|monta\w*|quero)\s+(?:a\s+|uma\s+)?(?:nova\s+)?categoria\s+(?:de\s+(?:receita|entrada|ganho|despesa|gasto)s?\s+)?(.+)/i);
  if (create) {
    const [namePart, kwPart] = create[1].split(/\s+(?:com|para|pra|que tenha|incluindo)\s+/i);
    const name = cleanName(namePart);
    if (!name || name.length > 40) return { reply: "Qual o nome da categoria? Ex.: “cria a categoria Beleza”.", actions: [] };
    const keywords = kwPart ? splitWords(kwPart) : [];
    return { reply: `Categoria ${name} criada! ${keywords.length ? `${cap(keywords.join(", "))} já entra${keywords.length > 1 ? "m" : ""} nela.` : `Agora me diga o que entra nela, por exemplo: “${kind === "income" ? "freela" : "barbearia"} vai na categoria ${name}”.`} ${pickEmoji(name + " " + keywords.join(" "))}`,
      actions: [{ type: "add_category", name, emoji: pickEmoji(name + " " + keywords.join(" ")), kind, keywords }] };
  }
  // "barbearia vai na categoria Beleza", "coloca academia na categoria Academia", "manicure é da categoria Beleza"
  const assign = raw.match(/^(.+?)\s+(?:(?:vai|vão|entra|entram|fica|ficam|é|e|são|sao|passa a ser|deve ir)\s+)?(?:(?:na|no|em|para|pra|da|de|dentro da)\s+)?(?:a\s+)?categoria\s+(?:de\s+)?(.+)$/i);
  if (assign) {
    const left = assign[1].replace(/^(?:coloca\w*|põe|poe|bota\w*|manda\w*|joga\w*|muda\w*|move\w*|lança\w*|lanca\w*)\s+/i, "")
      .replace(/\s+(?:vai|entra|fica|é|e)$/i, "").replace(/^(?:os gastos (?:de|da|do|com)|gastos (?:de|da|do|com)|o gasto (?:de|da|do|com))\s+/i, "");
    const keywords = splitWords(left);
    const name = cleanName(assign[2]);
    if (!keywords.length || !name) return null;
    return { reply: `Combinado! ${cap(keywords.join(", "))} agora entra${keywords.length > 1 ? "m" : ""} na categoria ${name}, inclusive o que já foi lançado. ${pickEmoji(name + " " + keywords.join(" "))}`,
      actions: [{ type: "add_category", name, emoji: pickEmoji(name + " " + keywords.join(" ")), kind, keywords }] };
  }
  return null;
}

const MONTHLY = /\b(todo (santo )?dia \d{1,2}|todo mes|todos os meses|todo começo de mes|mensalmente|por mes|fixo|fixa)\b/;
const INCOME_FIXED = /\b(salario|recebo|ganho|renda|pensao|aposentadoria|me pagam|meu pagamento)\b/;
const FIXED_NAMES: [RegExp, string][] = [
  [/salario/, "Salário"], [/aposentadoria/, "Aposentadoria"], [/pensao/, "Pensão"],
  [/aluguel/, "Aluguel"], [/condominio/, "Condomínio"], [/academia/, "Academia"], [/escola/, "Escola"],
  [/faculdade/, "Faculdade"], [/curso/, "Curso"], [/internet/, "Internet"], [/plano de saude/, "Plano de saúde"],
  [/financiamento/, "Financiamento"], [/parcela do carro/, "Parcela do carro"], [/parcela/, "Parcela"],
  [/diarista|faxina/, "Diarista"], [/celular|telefone/, "Celular"], [/seguro/, "Seguro"], [/mesada/, "Mesada"],
  [/creche/, "Creche"], [/consorcio/, "Consórcio"], [/emprestimo/, "Empréstimo"],
];

function parseFixed(raw: string, s: string): Out | null {
  if (!MONTHLY.test(s) || /\b(vence|boleto|conta de)\b/.test(s)) return null; // contas com vencimento: regra de contas
  const income = INCOME_FIXED.test(s);
  const dayM = s.match(/\bdia (\d{1,2})\b/);
  const day = dayM ? Number(dayM[1]) : null;
  const noDay = raw.replace(/\bdia \d{1,2}\b/gi, " ");
  let amount = parseMoney(noDay);
  if (!amount) {
    const m = noDay.replace(/(\d)\.(\d{3})/g, "$1$2").match(/\b(\d+(?:,\d{1,2})?)\b/);
    amount = m ? Number(m[1].replace(",", ".")) || null : null;
  }
  const name = FIXED_NAMES.find(([re]) => re.test(s))?.[1] ?? (income ? "Receita fixa" : "Despesa fixa");
  if (!day) return { reply: `Em qual dia do mês? Ex.: “todo dia 5”.`, actions: [] };
  if (day < 1 || day > 31) return null;
  if (!amount) return { reply: `Qual o valor ${income ? "que você recebe" : "que você paga"} todo mês?`, actions: [] };
  if (income) {
    return { reply: `Combinado! Todo dia ${day} eu lanço ${brl(toCents(amount))} de ${name.toLowerCase()} nas suas receitas. 💵`,
      actions: [{ type: "add_fixed", kind: "income", name, amount, day, category: /salario/.test(s) ? "salario" : "renda_extra" }] };
  }
  const auto = !/(me avisa|me lembra|lembrete|avisar)/.test(s);
  return { reply: auto
      ? `Combinado! Todo dia ${day} eu lanço ${brl(toCents(amount))} de ${name.toLowerCase()} nas suas despesas. 🔁`
      : `Combinado! Todo dia ${day} te aviso para pagar ${name.toLowerCase()} (${brl(toCents(amount))}). 🔔`,
    actions: [{ type: "add_fixed", kind: "expense", name, amount, day, category: guessCategory(s), auto }] };
}

function parseClause(text: string, today: string, history: { lastUser?: string; lastAssistant?: string } = {}): Out {
  const raw = text.trim();
  const s = norm(raw);

  const val = parseMoney(raw), date = parseDate(raw, today), time = parseTime(raw);
  const actions: Out["actions"] = [];
  const replies: string[] = [];

  // cartão de crédito: cadastro, compras parceladas, fatura, melhor dia
  const cardCmd = parseCard(raw, s, today);
  if (cardCmd) return cardCmd;

  // não deixe nada passar: problemas, vencimentos, garantias, compras de rotina
  const watch = parseWatch(raw, s, today);
  if (watch) return watch;

  // categorias: "cria a categoria Beleza", "barbearia vai na categoria Beleza", "apaga a categoria Beleza"
  const catCmd = parseCategory(raw, s);
  if (catCmd) return catCmd;

  // fixos do mês: "meu salário de 4200 cai todo dia 5", "pago 1500 de aluguel todo dia 10"
  const fixed = parseFixed(raw, s);
  if (fixed) return fixed;

  // receita
  if (/\b(recebi|ganhei|caiu (o )?salario)\b/.test(s)) {
    if (!val) return { reply: "Qual foi o valor que você recebeu?", actions: [] };
    return { reply: `Registrei a receita de ${brl(toCents(val))}. ✅`, actions: [{ type: "add_transaction", kind: "income", amount: val, category: /salario/.test(s) ? "salario" : "renda_extra", description: /salario/.test(s) ? "Salário" : "Receita" }] };
  }

  // despesa
  if (/\b(gastei|paguei|comprei)\b/.test(s)) {
    if (!val) {
      if (/\bpaguei (uma|a) conta\b/.test(s)) return { reply: "Qual conta e qual foi o valor?", actions: [] };
      if (/\bcomprei\b/.test(s) && /(ar-condicionado|geladeira|fogao|tv|televis|notebook|celular|maquina de lavar|sofa)/.test(s)) {
        return { reply: "Que legal! Quanto custou?", actions: [], suggestion: null };
      }
      return { reply: "Qual foi o valor?", actions: [] };
    }
    const cat = matchUserCat(s, "EXPENSE")?.key ?? guessCategory(s);
    const method = /cartao|credito/.test(s) ? "cartao" : /\bpix\b/.test(s) ? "pix" : /dinheiro/.test(s) ? "dinheiro" : /debito/.test(s) ? "debito" : undefined;
    const descMatch = raw.match(/(?:comprei|gastei|paguei)\s+(?:(?:r\$\s*)?[\d.,]+\s*(?:reais|real)?\s*)?(?:com |no |na |em |de |um |uma |o |a )?([^\d,.]{3,40}?)(?:\s+(?:por|hoje|no cart|com|de)\b|\s+r\$|\s+\d|[,.]|$)/i);
    const description = cap(descMatch?.[1]?.replace(/^(no|na|em|um|uma|o|a)\s+/i, "") || catName(cat));
    actions.push({ type: "add_transaction", kind: "expense", amount: val, category: cat, description, method });
    const durable = /(ar-condicionado|geladeira|fogao|\btv\b|televis|notebook|celular|maquina de lavar|sofa)/.test(s);
    return {
      reply: `Registrei ${brl(toCents(val))} em ${catName(cat)}. ✅`,
      actions,
      suggestion: durable ? { text: "Quer cadastrar a garantia?", yes: "Sim", no: "Não precisa", action: null } : null,
    };
  }

  // garantia ("sim, 1 ano")
  const war = s.match(/(\d+)\s*(ano|anos|mes|meses)\b/);
  if (war && history.lastAssistant && /garantia/.test(norm(history.lastAssistant))) {
    const months = Number(war[1]) * (war[2].startsWith("ano") ? 12 : 1);
    const item = history.lastUser?.match(/comprei (?:um |uma )?([a-zà-ú\- ]{3,30}?)(?:\s+(?:hoje|por|de|no|na)\b|\s+\d|$)/i)?.[1] ?? "produto";
    return { reply: `Pronto! Garantia de ${item} cadastrada. 🧾`, actions: [{ type: "add_warranty", item: cap(item), months }] };
  }

  // lista de compras
  const shop = raw.match(/(?:preciso comprar|tenho que comprar|estou sem|to sem|tô sem|acabou (?:o |a |os |as )?|comprar|falta(?:ndo)?)\s+(.+)/i);
  if (shop && !APPOINTMENT.test(s)) {
    const items = shop[1].replace(/[.!?]/g, "").split(/,|\s+e\s+/i)
      .map((x) => x.trim().replace(/^(o|a|os|as|de|um|uma|mais)\s+/i, "")).filter((x) => x && x.length < 40).map(cap);
    if (items.length) return { reply: `Coloquei na lista: ${items.join(", ")}. 🛒`, actions: [{ type: "add_shopping", items }] };
  }

  // lembrete
  if (/(me lembr|lembrete|me avisa)/.test(s)) {
    if (!date) return { reply: "Claro! Para quando é o lembrete?", actions: [] };
    const what = cap(stripDateWords(raw.replace(/.*?(me lembra(r)?|lembrete|me avisa)\s*(de |que |para )?/i, "")).replace(/[.!]$/, "")) || "Lembrete";
    return { reply: `Pode deixar, te lembro ${relDay(date, today).toLowerCase()}${time ? ` às ${time}` : ""}. 🔔`, actions: [{ type: "add_reminder", text: what, date, time }] };
  }

  // conta a pagar
  if (/(vence|pagar a conta|pagar o|conta de)/.test(s)) {
    const util = s.match(/\b(luz|energia|agua|gas)\b/)?.[1];
    const nm = raw.match(/(conta de [a-zà-ú]+|internet|aluguel|condom[íi]nio|seguro|cart[ãa]o|iptu|ipva)/i)?.[1]
      ?? (util ? `Conta de ${{ luz: "luz", energia: "luz", agua: "água", gas: "gás" }[util]}` : "Conta");
    const dd = s.match(/todo dia (\d{1,2})/);
    if (dd) return { reply: `Anotei: ${cap(nm)} vence todo dia ${dd[1]}. Te aviso antes. 🔔`, actions: [
      { type: "add_bill", name: cap(nm), dueDay: Number(dd[1]), recurring: true, amount: val ?? undefined },
      { type: "remember", fact: `${cap(nm)} vence todo dia ${dd[1]}` }] };
    if (date) return { reply: `Anotei ${cap(nm).toLowerCase()} para ${relDay(date, today).toLowerCase()}. 🔔`, actions: [{ type: "add_bill", name: cap(nm), dueDate: date, recurring: false, amount: val ?? undefined }] };
    if (/mes que vem|semana que vem/.test(s)) return { reply: `Qual dia vence ${nm.toLowerCase()}?`, actions: [] };
  }

  // compromisso
  const apt = s.match(APPOINTMENT);
  if (apt || (date && time)) {
    const weekly = s.match(/toda (segunda|terca|quarta|quinta|sexta)|todo (sabado|domingo)/);
    if (!date && !weekly) return { reply: `Claro! Qual dia ${apt ? `do ${apt[1]}` : "do compromisso"}?`, actions: [] };
    if (!time && apt && !/dia todo|dia inteiro|sem horario/.test(s)) return { reply: `Claro! 😊 Qual horário ${apt ? `do ${apt[1]}` : ""}?`.replace(" ?", "?"), actions: [] };
    const title = cap(stripDateWords(raw).replace(/^(tenho que|vou ter|tenho|vou|preciso)\s+/i, "").replace(/\b(toda|todo)\s+\S+/i, "").replace(/[.!]$/, "")) || cap(apt?.[1] ?? "Compromisso");
    const d = date ?? parseDate(weekly![0].replace(/toda |todo /, ""), today)!;
    actions.push({ type: "add_event", title, date: d, time, recur: weekly ? { freq: "weekly" } : undefined });
    replies.push(`Pronto! ${title} ${weekly ? `${weekly[0]}` : relDay(d, today).toLowerCase()}${time ? ` às ${time}` : ""}. 👍`);
    return {
      reply: replies.join(" "), actions,
      suggestion: time && !weekly ? { text: "Quer que eu te lembre 1 dia antes?", yes: "Sim, lembrar", no: "Não precisa", action: { type: "set_event_reminder", ref: "new:0", days: 1 } } : null,
    };
  }

  // tarefa
  if (/\b(preciso|tenho que|nao posso esquecer|anota)\b/.test(s)) {
    // "semana que vem" sem dia → segunda que vem; "mês que vem" → dia 1 do próximo mês
    const due = date ?? (/semana que vem|proxima semana/.test(s) ? addDays(today, ((8 - weekday(today)) % 7) || 7)
      : /mes que vem|proximo mes/.test(s) ? addMonths(today.slice(0, 8) + "01", 1) : null);
    const title = cap(stripDateWords(raw.replace(/.*?\b(preciso|tenho que|não posso esquecer de|nao posso esquecer de|anota)\b\s*(de |que )?/i, ""))
      .replace(/\s*(para |pra |na |no )?(a )?(semana que vem|próxima semana|proxima semana|mês que vem|mes que vem|próximo mês|proximo mes)/i, "").replace(/[.!]$/, ""));
    return { reply: `Anotei a tarefa${due ? ` para ${relDay(due, today).toLowerCase()}` : ""}. ✅`, actions: [{ type: "add_task", title: title || cap(raw), due: due ?? undefined }] };
  }

  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai)\b/.test(s)) return { reply: "Oi! Me conta o que você precisa lembrar, pagar ou comprar. 😊", actions: [] };

  return { reply: "Não entendi direito. Pode dizer de outro jeito? Ex.: \"Gastei 45 reais no almoço\" ou \"Tenho dentista dia 20 às 14h\".", actions: [] };
}
