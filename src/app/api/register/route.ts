import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { AppError, route, tooMany } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { defaultPlan } from "@/lib/plans";
import { ensureUserSetup } from "@/lib/data/user-setup";
import { log } from "@/lib/logger";

const schema = z.object({
  name: z.string().trim().min(1, "Informe seu nome").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(200),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres").max(200),
});

export const POST = route("register", async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`register:${ip}`, 5, 60 * 60_000)) throw tooMany("Muitos cadastros deste endereço. Tente mais tarde.");

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message ?? "Dados inválidos.", "invalid_input");
  const { name, email, password } = parsed.data;

  const db = getDb();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (exists) throw new AppError(409, "Já existe uma conta com esse e-mail. Entre com ele.", "email_taken");

  const passwordHash = await bcrypt.hash(password, 12);
  const [u] = await db.insert(users).values({ name, email, passwordHash, plan: defaultPlan() }).returning({ id: users.id });
  await ensureUserSetup(db, u.id);
  log.info("auth.user_created", { userId: u.id, method: "password" });
  return NextResponse.json({ ok: true }, { status: 201 });
});
