/**
 * Exclusão de conta (exigida pela Google Play e pela LGPD).
 * Cancela a assinatura no Asaas, apaga os arquivos guardados e remove a pessoa;
 * o resto dos dados some junto pelo ON DELETE CASCADE do banco.
 */
import { eq, isNotNull, and } from "drizzle-orm";
import type { DB } from "@/db";
import { documents, users } from "@/db/schema";
import type { User } from "@/db/schema";
import { cancelBilling } from "@/lib/billing";
import { deleteFile } from "@/lib/storage";
import { log } from "@/lib/logger";

export async function deleteAccount(db: DB, user: User) {
  await cancelBilling(db, user, { immediate: true }).catch((e) => log.error("account.delete.billing", { userId: user.id, err: String(e) }));
  const files = await db.select({ key: documents.fileKey }).from(documents)
    .where(and(eq(documents.userId, user.id), isNotNull(documents.fileKey)));
  for (const f of files) await deleteFile(f.key!).catch(() => undefined);
  await db.delete(users).where(eq(users.id, user.id));
  log.info("account.deleted", { userId: user.id });
}
