import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Protege todas as páginas e APIs, exceto login/cadastro e arquivos estáticos.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|manifest.webmanifest|sw.js|offline.html).*)"],
};
