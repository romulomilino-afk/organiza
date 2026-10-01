/**
 * Camada de intenções: o contrato entre a IA e o banco.
 * A IA só pode pedir estas ações; tudo é validado aqui antes de tocar no banco.
 */
import { z } from "zod";
import { isISODate, isTime } from "../dates";
import { EXPENSE_KEYS, INCOME_KEYS } from "../categories";

const txt = (max = 160) => z.string().trim().min(1).max(max);
const day = z.string().refine(isISODate, "data inválida (YYYY-MM-DD)");
const hhmm = z.string().refine(isTime, "horário inválido (HH:MM)");
const optDay = day.nullish().transform((v) => v ?? undefined);
const optTime = hhmm.nullish().transform((v) => v ?? undefined);
const reais = z.coerce.number().positive().max(10_000_000);
const optReais = reais.nullish().transform((v) => v ?? undefined);
const idRef = z.string().trim().min(1).max(64);
const items = z.array(txt(80)).min(1).max(50);
const shared = z.boolean().nullish().transform((v) => v ?? false); // compartilhar com a família

export const ActionSchema = z.discriminatedUnion("type", [
  // Agenda
  z.object({ type: z.literal("add_event"), title: txt(), date: day, time: optTime, notes: z.string().max(500).nullish(),
    recur: z.object({ freq: z.enum(["daily", "weekly", "monthly", "yearly"]), interval: z.coerce.number().int().min(1).max(12).nullish() }).nullish(), shared }),
  z.object({ type: z.literal("update_event"), id: idRef, title: txt().nullish(), date: optDay, time: optTime }),
  z.object({ type: z.literal("cancel_event"), id: idRef }),
  z.object({ type: z.literal("set_event_reminder"), ref: idRef, days: z.coerce.number().int().min(0).max(30).default(1) }),
  // Tarefas
  z.object({ type: z.literal("add_task"), title: txt(), due: optDay, shared }),
  z.object({ type: z.literal("complete_task"), id: idRef }),
  z.object({ type: z.literal("postpone_task"), id: idRef, due: day }),
  // Lembretes
  z.object({ type: z.literal("add_reminder"), text: txt(), date: day, time: optTime }),
  z.object({ type: z.literal("update_reminder"), id: idRef, text: txt().nullish(), date: optDay, time: optTime }),
  z.object({ type: z.literal("cancel_reminder"), id: idRef }),
  // Financeiro
  z.object({ type: z.literal("add_transaction"), kind: z.enum(["expense", "income"]), amount: reais,
    category: z.string().default("outros"), description: txt(120),
    method: z.enum(["cartao", "pix", "dinheiro", "debito", "boleto"]).nullish(), date: optDay, shared }),
  z.object({ type: z.literal("add_bill"), name: txt(80), amount: optReais,
    dueDay: z.coerce.number().int().min(1).max(31).nullish(), dueDate: optDay, recurring: z.boolean().default(false) })
    .refine((a) => a.dueDay || a.dueDate, "conta precisa de dueDay ou dueDate"),
  z.object({ type: z.literal("pay_bill"), id: idRef, amount: optReais }),
  // Fixos do mês: receita fixa (lança sozinha), despesa fixa (auto=true lança sozinha como paga; auto=false vira conta a pagar)
  z.object({ type: z.literal("add_fixed"), kind: z.enum(["income", "expense"]), name: txt(80), amount: reais,
    day: z.coerce.number().int().min(1).max(31), category: z.string().default("outros"),
    auto: z.boolean().nullish().transform((v) => v ?? true) }),
  z.object({ type: z.literal("update_fixed"), id: idRef, amount: optReais,
    day: z.coerce.number().int().min(1).max(31).nullish(), name: txt(80).nullish() }),
  z.object({ type: z.literal("cancel_fixed"), id: idRef }),
  // Compras
  z.object({ type: z.literal("add_shopping"), items }),
  z.object({ type: z.literal("remove_shopping"), items }),
  z.object({ type: z.literal("check_shopping"), items }),
  // Casa (fase 2 na interface, já persistidos)
  z.object({ type: z.literal("add_subscription"), name: txt(80), amount: reais, cycle: z.enum(["monthly", "yearly"]).default("monthly") }),
  z.object({ type: z.literal("cancel_subscription"), id: idRef }),
  z.object({ type: z.literal("add_warranty"), item: txt(80), months: z.coerce.number().int().min(1).max(240), purchaseDate: optDay }),
  z.object({ type: z.literal("add_document"), name: txt(120),
    category: z.enum(["nota_fiscal", "documento", "contrato", "garantia", "manual", "outro"]).default("outro"),
    expires: optDay, notes: z.string().max(500).nullish() }),
  // Memória
  z.object({ type: z.literal("remember"), fact: txt(240) }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionType = Action["type"];

export const SuggestionSchema = z.object({
  text: txt(200),
  yes: txt(40).default("Sim"),
  no: txt(40).default("Não precisa"),
  action: ActionSchema.nullish(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

/** Saída bruta esperada do modelo. Ações são validadas uma a uma depois. */
export const NinaOutputSchema = z.object({
  reply: z.string().trim().min(1).max(800),
  actions: z.array(z.unknown()).max(20).default([]),
  suggestion: z.unknown().nullish(),
});

export type NinaOutput = { reply: string; actions: Action[]; suggestion: Suggestion | null; invalid: number };

/** Valida a saída do modelo: descarta ações inválidas em vez de falhar a mensagem inteira. */
export function parseNinaOutput(raw: unknown): NinaOutput {
  const base = NinaOutputSchema.parse(raw);
  const actions: Action[] = [];
  let invalid = 0;
  for (const a of base.actions) {
    const r = ActionSchema.safeParse(a);
    if (r.success) actions.push(normalizeAction(r.data));
    else invalid++;
  }
  let suggestion: Suggestion | null = null;
  if (base.suggestion) {
    const s = SuggestionSchema.safeParse(base.suggestion);
    if (s.success) suggestion = s.data;
  }
  return { reply: base.reply, actions, suggestion, invalid };
}

function normalizeAction(a: Action): Action {
  if (a.type === "add_transaction" || a.type === "add_fixed") {
    const allowed: readonly string[] = a.kind === "income" ? INCOME_KEYS : EXPENSE_KEYS;
    return { ...a, category: allowed.includes(a.category) ? a.category : "outros" };
  }
  return a;
}

/** JSON Schema da ferramenta enviada ao modelo (saída estruturada forçada). */
export const ORGANIZE_TOOL = {
  name: "organizar",
  description: "Devolve a resposta curta da Nina e as ações que o app deve executar no banco do usuário.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: { type: "string", description: "Resposta curta e natural em português do Brasil (1-2 frases)." },
      actions: {
        type: "array",
        description: "Ações a executar. Vazio se faltar informação ou se for só uma pergunta.",
        items: { type: "object", properties: { type: { type: "string" } }, required: ["type"], additionalProperties: true },
      },
      suggestion: {
        type: ["object", "null"],
        description: "Oferta opcional com botões Sim/Não (ex.: lembrar 1 dia antes).",
        properties: {
          text: { type: "string" }, yes: { type: "string" }, no: { type: "string" },
          action: { type: ["object", "null"], additionalProperties: true },
        },
      },
    },
    required: ["reply", "actions"],
  },
};
