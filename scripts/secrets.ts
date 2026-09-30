/**
 * Gera os segredos do .env de uma vez.  Uso: npm run secrets
 */
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const vapid = webpush.generateVAPIDKeys();
const lines = [
  `AUTH_SECRET="${randomBytes(32).toString("base64")}"`,
  `CRON_SECRET="${randomBytes(24).toString("base64url")}"`,
  `FILES_ENCRYPTION_KEY="${randomBytes(32).toString("hex")}"`,
  `VAPID_PUBLIC_KEY="${vapid.publicKey}"`,
  `VAPID_PRIVATE_KEY="${vapid.privateKey}"`,
  `ASAAS_WEBHOOK_TOKEN="${randomBytes(32).toString("base64url")}"`,
  `WHATSAPP_VERIFY_TOKEN="${randomBytes(16).toString("base64url")}"`,
];
console.log("# Cole no seu .env:\n" + lines.join("\n"));
