/**
 * Interpretador por regras — usado quando não há chave de IA configurada ou a IA falha.
 * Cobre os casos mais comuns do dia a dia. A IA (llm.ts) cobre o resto.
 * Função pura: facilita testes.
 */
import { addDays, dateInMonth, addMonths, weekday, cap, relDay } from "../dates";
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
    ["saude", /farmacia|remedio|medico|dentista|exame|consulta|hospital/],
    ["assinaturas", /netflix|spotify|assinatura|prime video|disney|youtube premium/],
    ["casa", /\bluz\b|energia|\bagua\b|internet|aluguel|condominio|\bgas\b|faxina|diarista/],
    ["educacao", /escola|curso|faculdade|livro|mensalidade/],
    ["lazer", /cinema|show|\bbar\b|viagem|passeio|ingresso|festa/],
    ["compras", /roupa|tenis|camisa|calca|sapato|presente|loja|celular|fone|ar-condicionado|geladeira|tv\b/],
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
function matchUserCat(s: string, kind: "EXPENSE" | "INCOME"): UserCat | null {
  let best: { c: UserCat; n: number } | null = null;
  for (const c of userCats) if (c.kind === kind) for (const k of c.keywords) {
    const kw = norm(k);
    if (kw.length >= 3 && s.includes(kw) && (!best || kw.length > best.n)) best = { c, n: kw.length };
  }
  return best?.c ?? null;
}
const catName = (key: string) => userCats.find((c) => c.key === key)?.name ?? CAT_NAME[key] ?? "Outros";

export function fallbackNina(text: string, today: string, history: { lastUser?: string; lastAssistant?: string } = {}, opts: { family?: boolean; categories?: UserCat[] } = {}): Out {
  userCats = opts.categories ?? [];
  let out: Out;
  try { out = fallbackCore(text, today, history); } finally { userCats = []; }
  // na família: "a gente", "família", "casa", "nós"… compartilha compromissos e tarefas
  if (opts.family && /\b(familia|família|a gente|nós|nos vamos|compartilh|todo mundo|lá em casa)\b/i.test(text)) {
    for (const a of out.actions) if (a.type === "add_event" || a.type === "add_task") a.shared = true;
  }
  return out;
}

function fallbackCore(text: string, today: string, history: { lastUser?: string; lastAssistant?: string } = {}): Out {
  const raw = text.trim();
  const s = norm(raw);

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
    const title = cap(stripDateWords(raw.replace(/.*?\b(preciso|tenho que|não posso esquecer de|nao posso esquecer de|anota)\b\s*(de |que )?/i, "")).replace(/[.!]$/, ""));
    return { reply: `Anotei a tarefa${date ? ` para ${relDay(date, today).toLowerCase()}` : ""}. ✅`, actions: [{ type: "add_task", title: title || cap(raw), due: date ?? undefined }] };
  }

  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai)\b/.test(s)) return { reply: "Oi! Me conta o que você precisa lembrar, pagar ou comprar. 😊", actions: [] };

  return { reply: "Não entendi direito. Pode dizer de outro jeito? Ex.: \"Gastei 45 reais no almoço\" ou \"Tenho dentista dia 20 às 14h\".", actions: [] };
}
