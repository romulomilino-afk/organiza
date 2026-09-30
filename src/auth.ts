import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { getDb } from "./db";
import { users, accounts, sessions, verificationTokens } from "./db/schema";
import { rateLimit } from "./lib/rate-limit";
import { defaultPlan } from "./lib/plans";
import { log } from "./lib/logger";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
});

const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
const DUMMY_HASH = bcrypt.hashSync("organiza-dummy-password", 10);

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const db = getDb();
  return {
    ...authConfig,
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    providers: [
      Credentials({
        credentials: { email: {}, password: {} },
        async authorize(raw) {
          const parsed = credentialsSchema.safeParse(raw);
          if (!parsed.success) return null;
          const { email, password } = parsed.data;
          // freio contra força bruta: 10 tentativas por e-mail a cada 15 min
          if (!rateLimit(`login:${email}`, 10, 15 * 60_000)) {
            log.warn("auth.rate_limited", { emailDomain: email.split("@")[1] });
            return null;
          }
          const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
          if (!u?.passwordHash) {
            await bcrypt.compare(password, DUMMY_HASH); // tempo constante: não revela se o e-mail existe
            return null;
          }
          const ok = await bcrypt.compare(password, u.passwordHash);
          if (!ok) return null;
          log.info("auth.login", { userId: u.id, method: "password" });
          return { id: u.id, name: u.name, email: u.email };
        },
      }),
      ...(googleEnabled ? [Google({ allowDangerousEmailAccountLinking: false })] : []),
    ],
    events: {
      async createUser({ user }) {
        // usuários criados via Google recebem o plano padrão do ambiente
        if (user.id) await db.update(users).set({ plan: defaultPlan() }).where(eq(users.id, user.id));
        log.info("auth.user_created", { userId: user.id, method: "oauth" });
      },
    },
  };
});

export const isGoogleEnabled = googleEnabled;
