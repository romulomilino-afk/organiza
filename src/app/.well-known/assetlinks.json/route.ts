/**
 * Digital Asset Links: prova para o Android que o app da Play Store é deste site.
 * Sem isso, o app abre com a barra de endereço do navegador no topo.
 * Configure no Netlify: ANDROID_PACKAGE (ex.: br.com.meuorganiza.app) e
 * ANDROID_SHA256 (impressões digitais SHA-256 separadas por vírgula, copiadas do Play Console).
 */
export const dynamic = "force-dynamic";

export function GET() {
  const pkg = process.env.ANDROID_PACKAGE?.trim() || "br.com.meuorganiza.app";
  const prints = (process.env.ANDROID_SHA256 ?? "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  const body = prints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }]
    : [];
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=300" } });
}
