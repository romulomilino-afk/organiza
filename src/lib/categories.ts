/** Categorias padrão do sistema (também gravadas na tabela `categories`). */
export const CATEGORIES = {
  alimentacao: { name: "Alimentação", emoji: "🍔", kind: "EXPENSE" },
  transporte: { name: "Transporte", emoji: "🚗", kind: "EXPENSE" },
  casa: { name: "Casa", emoji: "🏠", kind: "EXPENSE" },
  compras: { name: "Compras", emoji: "🛍️", kind: "EXPENSE" },
  saude: { name: "Saúde", emoji: "💊", kind: "EXPENSE" },
  educacao: { name: "Educação", emoji: "🎓", kind: "EXPENSE" },
  lazer: { name: "Lazer", emoji: "🎉", kind: "EXPENSE" },
  assinaturas: { name: "Assinaturas", emoji: "📱", kind: "EXPENSE" },
  outros: { name: "Outros", emoji: "📦", kind: "EXPENSE" },
  salario: { name: "Salário", emoji: "💼", kind: "INCOME" },
  renda_extra: { name: "Renda extra", emoji: "✨", kind: "INCOME" },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;
export const EXPENSE_KEYS = ["alimentacao", "transporte", "casa", "compras", "saude", "educacao", "lazer", "assinaturas", "outros"] as const;
export const INCOME_KEYS = ["salario", "renda_extra", "outros"] as const;

export function category(key: string | null | undefined) {
  return CATEGORIES[(key ?? "outros") as CategoryKey] ?? CATEGORIES.outros;
}
