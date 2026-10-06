/** Exclusão de conta (Google Play / LGPD). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { DB } from "../src/db";
import { ensureUserSetup } from "../src/lib/data/user-setup";
import { deleteAccount } from "../src/lib/account";
import { putFile, setStorageDb } from "../src/lib/storage";
import { GET as assetlinks } from "../src/app/.well-known/assetlinks.json/route";

let db: DB;
before(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  process.env.STORAGE_DRIVER = "db";
  setStorageDb(db as never);
});

test("excluir conta apaga a pessoa, os dados e os arquivos, e não toca nos outros", async () => {
  const [a] = await db.insert(schema.users).values({ email: "a@x.com", name: "A", onboarded: true }).returning();
  const [b] = await db.insert(schema.users).values({ email: "b@x.com", name: "B", onboarded: true }).returning();
  await ensureUserSetup(db, a.id); await ensureUserSetup(db, b.id);
  await db.insert(schema.tasks).values({ userId: a.id, title: "renovar CNH" });
  await db.insert(schema.tasks).values({ userId: b.id, title: "mercado" });
  const key = await putFile(a.id, Buffer.from("conteudo"));
  await db.insert(schema.documents).values({ userId: a.id, name: "CNH", date: "2026-10-06", fileKey: key });
  await db.insert(schema.billingSubscriptions).values({ userId: a.id, providerSubscriptionId: "checkout:x", plan: "PREMIUM", valueCents: 1990 });

  await deleteAccount(db, a);

  assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, a.id))).length, 0);
  assert.equal((await db.select().from(schema.tasks).where(eq(schema.tasks.userId, a.id))).length, 0);
  assert.equal((await db.select().from(schema.documentFiles).where(eq(schema.documentFiles.key, key))).length, 0);
  assert.equal((await db.select().from(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, a.id))).length, 0);
  assert.equal((await db.select().from(schema.tasks).where(eq(schema.tasks.userId, b.id))).length, 1);
});

test("assetlinks.json usa o pacote e as impressões digitais do ambiente", async () => {
  delete process.env.ANDROID_SHA256;
  assert.deepEqual(await assetlinks().json(), []);
  const fp = Array.from({ length: 32 }, () => "ab").join(":");
  process.env.ANDROID_PACKAGE = "br.com.meuorganiza.app";
  process.env.ANDROID_SHA256 = `${fp}, lixo`;
  const [entry] = await assetlinks().json();
  assert.equal(entry.target.package_name, "br.com.meuorganiza.app");
  assert.deepEqual(entry.target.sha256_cert_fingerprints, [fp.toUpperCase()]);
});
