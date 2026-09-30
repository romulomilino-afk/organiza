/**
 * Armazenamento de arquivos dos usuários (notas fiscais, contratos, documentos…).
 *
 * - Todo arquivo é criptografado (AES-256-GCM) ANTES de sair do servidor: nem o disco nem o bucket veem o conteúdo.
 * - Driver "local" (pasta ./storage) para desenvolvimento; "s3" para produção (AWS S3, Cloudflare R2, MinIO…).
 * - O tipo do arquivo é conferido pelos primeiros bytes, não pela extensão.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const USER_QUOTA_BYTES = 500 * 1024 * 1024;

/** Detecta o tipo real pelo conteúdo. */
export function sniffMime(buf: Uint8Array): string | null {
  const hex = Buffer.from(buf.slice(0, 16)).toString("hex");
  const ascii = Buffer.from(buf.slice(0, 16)).toString("latin1");
  if (ascii.startsWith("%PDF-")) return "application/pdf";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
  if (ascii.slice(4, 8) === "ftyp" && /heic|heix|mif1|msf1|hevc/.test(ascii.slice(8, 12))) return "image/heic";
  return null;
}

function encryptionKey(): Buffer {
  const k = process.env.FILES_ENCRYPTION_KEY;
  if (k) {
    const b = /^[0-9a-f]{64}$/i.test(k) ? Buffer.from(k, "hex") : Buffer.from(k, "base64");
    if (b.length !== 32) throw new Error("FILES_ENCRYPTION_KEY precisa ter 32 bytes (64 hex ou base64)");
    return b;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Configure FILES_ENCRYPTION_KEY em produção");
  // desenvolvimento: deriva do AUTH_SECRET
  return createHash("sha256").update(`organiza-files:${process.env.AUTH_SECRET ?? "dev"}`).digest();
}

export function encrypt(data: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function decrypt(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), body = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

const driver = () => (process.env.STORAGE_DRIVER === "s3" ? "s3" : "local");
const localDir = () => path.resolve(process.env.STORAGE_DIR || "./storage");
let s3: S3Client | null = null;
function s3c() {
  s3 ??= new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  return s3;
}

/** Salva (criptografado) e devolve a chave. */
export async function putFile(userId: string, data: Buffer): Promise<string> {
  const key = `${userId}/${randomUUID()}`;
  const blob = encrypt(data);
  if (driver() === "s3") {
    await s3c().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: blob, ContentType: "application/octet-stream" }));
  } else {
    const file = path.join(localDir(), key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, blob, { mode: 0o600 });
  }
  return key;
}

export async function getFile(key: string): Promise<Buffer> {
  if (!/^[\w-]+\/[\w-]+$/.test(key)) throw new Error("chave inválida");
  if (driver() === "s3") {
    const r = await s3c().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return decrypt(Buffer.from(await r.Body!.transformToByteArray()));
  }
  return decrypt(await readFile(path.join(localDir(), key)));
}

export async function deleteFile(key: string): Promise<void> {
  if (!/^[\w-]+\/[\w-]+$/.test(key)) return;
  if (driver() === "s3") await s3c().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
  else await rm(path.join(localDir(), key), { force: true });
}
