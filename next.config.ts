import type { NextConfig } from "next";

// Cabeçalhos de segurança aplicados a todas as respostas.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microfone liberado apenas para a própria origem (entrada por voz)
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // gravado na hora do build: no Netlify, os arquivos vão para o Netlify Blobs (o disco do servidor é só leitura)
  env: { ORGANIZA_ON_NETLIFY: process.env.NETLIFY === "true" ? "1" : "" },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
