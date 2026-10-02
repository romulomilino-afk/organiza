/**
 * Categorias de cada pessoa: as padrão do sistema + as que ela criou (com palavras-chave).
 * Uma categoria do usuário com a mesma chave de uma padrão (ex.: "saude") só acrescenta palavras-chave a ela.
 */
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { DB } from "@/db";
import { categories, expenses, income, recurringItems } from "@/db/schema";
import { CATEGORIES, EXPENSE_KEYS, INCOME_KEYS } from "../categories";

export type Cat = { key: string; name: string; emoji: string; kind: "EXPENSE" | "INCOME"; custom: boolean; keywords: string[] };

export const normText = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
export const slugKey = (name: string) => normText(name).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "categoria";

export class UserCategories {
  constructor(readonly list: Cat[]) {}
  private byKey() { return new Map(this.list.map((c) => [c.key, c])); }

  get(key: string | null | undefined): Cat {
    return this.byKey().get(key ?? "outros") ?? this.byKey().get("outros")!;
  }
  /** Categoria por chave ou por nome ("Beleza", "beleza", "Cuidados pessoais"). */
  find(keyOrName: string | null | undefined): Cat | null {
    if (!keyOrName) return null;
    const k = slugKey(keyOrName);
    return this.byKey().get(keyOrName) ?? this.byKey().get(k) ?? this.list.find((c) => slugKey(c.name) === k) ?? null;
  }
  /** Categoria por palavra-chave do usuário encontrada no texto (a palavra mais longa ganha). */
  matchKeyword(text: string, kind: "EXPENSE" | "INCOME"): Cat | null {
    const t = ` ${normText(text)} `;
    let best: { cat: Cat; len: number } | null = null;
    for (const c of this.list) {
      if (c.kind !== kind) continue;
      for (const kw of c.keywords) {
        const k = normText(kw);
        if (k.length >= 3 && t.includes(k) && (!best || k.length > best.len)) best = { cat: c, len: k.length };
      }
    }
    return best?.cat ?? null;
  }
  /** Decide a categoria final de um lançamento: palavra-chave do usuário > categoria pedida > "outros". */
  resolve(requested: string | null | undefined, description: string, kind: "EXPENSE" | "INCOME"): string {
    const byKw = this.matchKeyword(description, kind);
    if (byKw) return byKw.key;
    const c = this.find(requested);
    if (c && (c.kind === kind || c.key === "outros")) return c.key;
    return kind === "INCOME" ? "renda_extra" : "outros";
  }
  expense() { return this.list.filter((c) => c.kind === "EXPENSE"); }
  income() { return this.list.filter((c) => c.kind === "INCOME"); }
  custom() { return this.list.filter((c) => c.custom); }
}

export async function loadCategories(db: DB, userId: string): Promise<UserCategories> {
  const rows = await db.select().from(categories).where(or(eq(categories.userId, userId), isNull(categories.userId)));
  const own = rows.filter((r) => r.userId === userId);
  const list: Cat[] = [];
  const order = [...EXPENSE_KEYS, ...INCOME_KEYS.filter((k) => k !== "outros")];
  for (const key of order) {
    const d = CATEGORIES[key];
    const o = own.find((r) => r.key === key);
    list.push({ key, name: o?.name ?? d.name, emoji: o?.emoji ?? d.emoji, kind: d.kind, custom: false, keywords: o?.keywords ?? [] });
  }
  for (const r of own) {
    if (order.includes(r.key as (typeof order)[number])) continue;
    list.push({ key: r.key, name: r.name, emoji: r.emoji, kind: r.kind, custom: true, keywords: r.keywords });
  }
  return new UserCategories(list);
}

/** Cria a categoria (ou acrescenta palavras-chave a uma existente). Devolve a categoria e se é nova. */
export async function upsertCategory(db: DB, userId: string, cats: UserCategories,
  input: { name: string; emoji?: string | null; kind: "EXPENSE" | "INCOME"; keywords: string[] }): Promise<{ cat: Cat; created: boolean }> {
  const existing = cats.find(input.name);
  const key = existing?.key ?? slugKey(input.name);
  const kws = [...new Set([...(existing?.keywords ?? []), ...input.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3)])].slice(0, 40);
  const name = existing?.name ?? (input.name.trim().charAt(0).toUpperCase() + input.name.trim().slice(1)).slice(0, 40);
  const emoji = input.emoji?.trim().slice(0, 8) || existing?.emoji || "🏷️";
  const kind = existing?.kind ?? input.kind;
  const [row] = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, userId), eq(categories.key, key))).limit(1);
  const finalEmoji = existing?.emoji ?? emoji; // categoria que já existe mantém o emoji
  if (row) await db.update(categories).set({ keywords: kws }).where(eq(categories.id, row.id));
  else await db.insert(categories).values({ userId, key, name, emoji: finalEmoji, kind, keywords: kws });
  return { cat: { key, name, emoji: finalEmoji, kind, custom: !CATEGORIES[key as keyof typeof CATEGORIES], keywords: kws }, created: !existing };
}

/** Move para a categoria os lançamentos (e fixos) cuja descrição tem uma das palavras-chave. Devolve quantos lançamentos mudaram. */
export async function moveByKeywords(db: DB, userId: string, cat: Cat): Promise<number> {
  const kws = cat.keywords.map(normText).filter((k) => k.length >= 3);
  if (!kws.length) return 0;
  const hit = (d: string) => { const t = normText(d); return kws.some((k) => t.includes(k)); };
  let moved = 0;
  if (cat.kind === "EXPENSE") {
    const rows = await db.select({ id: expenses.id, d: expenses.description }).from(expenses)
      .where(and(eq(expenses.userId, userId), ne(expenses.categoryKey, cat.key))).limit(5000);
    const ids = rows.filter((r) => hit(r.d)).map((r) => r.id);
    if (ids.length) await db.update(expenses).set({ categoryKey: cat.key }).where(and(eq(expenses.userId, userId), inArray(expenses.id, ids)));
    moved = ids.length;
  } else {
    const rows = await db.select({ id: income.id, d: income.description }).from(income)
      .where(and(eq(income.userId, userId), ne(income.categoryKey, cat.key))).limit(5000);
    const ids = rows.filter((r) => hit(r.d)).map((r) => r.id);
    if (ids.length) await db.update(income).set({ categoryKey: cat.key }).where(and(eq(income.userId, userId), inArray(income.id, ids)));
    moved = ids.length;
  }
  const fixed = await db.select({ id: recurringItems.id, d: recurringItems.name, kind: recurringItems.kind }).from(recurringItems)
    .where(eq(recurringItems.userId, userId));
  const fids = fixed.filter((f) => (f.kind === "INCOME") === (cat.kind === "INCOME") && hit(f.d)).map((f) => f.id);
  if (fids.length) await db.update(recurringItems).set({ categoryKey: cat.key }).where(and(eq(recurringItems.userId, userId), inArray(recurringItems.id, fids)));
  return moved;
}
