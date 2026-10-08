import type { Metadata, Viewport } from "next";
// Fontes empacotadas pelo npm: sem chamada externa no build nem em produção
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Meu Organiza",
  description: "Você fala. A gente organiza. Sua assistente pessoal, a Nina, cuida da sua agenda, tarefas, dinheiro e compras.",
  applicationName: "Meu Organiza",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Meu Organiza", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F5F7F6" }, { media: "(prefers-color-scheme: dark)", color: "#0E1312" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="font-sans text-[16px] leading-normal min-h-dvh">{children}<RegisterSW /></body>
    </html>
  );
}
