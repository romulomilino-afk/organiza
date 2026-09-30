import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __organizaPool?: Pool; __organizaDb?: DB };

/** Conexão única por processo (evita esgotar conexões com hot reload no dev). */
export function getDb(): DB {
  if (g.__organizaDb) return g.__organizaDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada. Copie .env.example para .env.");
  g.__organizaPool ??= new Pool({ connectionString: url, max: 10 });
  g.__organizaDb = drizzle(g.__organizaPool, { schema }) as unknown as DB;
  return g.__organizaDb;
}

/** Usado pelos testes para rodar contra um Postgres em memória (PGlite). */
export function setDb(db: DB) {
  g.__organizaDb = db;
}

export { schema };
