/**
 * Aplica as migrações e grava as categorias padrão.
 * Uso: npm run db:migrate
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { CATEGORIES } from "../lib/categories";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada");
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  console.log("→ aplicando migrações…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("→ gravando categorias padrão…");
  for (const [key, c] of Object.entries(CATEGORIES)) {
    await db.execute(sql`
      insert into categories (id, user_id, key, name, emoji, kind)
      select ${crypto.randomUUID()}, null, ${key}, ${c.name}, ${c.emoji}, ${c.kind}::category_kind
      where not exists (select 1 from categories where user_id is null and key = ${key})`);
  }
  await pool.end();
  console.log("✓ banco pronto");
}

main().catch((e) => { console.error(e); process.exit(1); });
