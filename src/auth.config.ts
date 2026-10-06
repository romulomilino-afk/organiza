import type { NextAuthConfig } from "next-auth";

/**
 * Parte da configuração que roda no middleware (Edge): sem banco, sem bcrypt.
 */
// Webhooks e cron têm autenticação própria (assinatura/segredo), não sessão.
const PUBLIC = ["/login", "/cadastro", "/privacidade", "/excluir-conta", "/.well-known", "/api/auth", "/api/register", "/api/cron", "/api/webhooks"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
      if (isPublic) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
