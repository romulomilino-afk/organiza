/**
 * Netlify: chama o "tick" do Organiza a cada 5 minutos (avisos + assinaturas).
 * Substitui o agendador externo quando o app roda no Netlify.
 * Precisa da variável CRON_SECRET configurada no Netlify.
 */
export default async () => {
  const base = process.env.URL; // definido automaticamente pelo Netlify
  const res = await fetch(`${base}/api/cron/tick`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
  });
  console.log("tick", res.status, await res.text());
};

export const config = { schedule: "*/5 * * * *" };
