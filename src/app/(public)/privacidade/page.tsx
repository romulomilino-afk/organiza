import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de Privacidade · Organiza" };

const UPDATED = "6 de outubro de 2026";

function S({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const email = process.env.SUPPORT_EMAIL?.trim();
  const contact = email ? <a href={`mailto:${email}`} className="font-semibold text-accent">{email}</a> : <b>o e-mail de suporte informado na loja de aplicativos</b>;
  return (
    <article className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-bold leading-tight">Política de Privacidade</h1>
        <p className="mt-1 text-sm text-ink-3">Atualizada em {UPDATED}</p>
      </div>
      <p className="text-[15px] leading-relaxed text-ink-2">
        O Organiza é um assistente pessoal: você fala ou escreve, e a Nina organiza sua agenda, tarefas, dinheiro, casa e família.
        Esta política explica, de forma simples, quais dados usamos, para quê e quais são os seus direitos pela LGPD (Lei 13.709/2018).
      </p>

      <S title="1. Dados que coletamos">
        <p><b>Cadastro:</b> nome, e-mail e senha (guardada de forma cifrada, nunca em texto). Se você entrar com o Google, recebemos nome e e-mail da sua conta Google.</p>
        <p><b>O que você conta para a Nina:</b> mensagens, áudios, gastos, receitas, contas fixas, categorias, cartões e parcelas, tarefas, compromissos, lembretes, prazos, listas de compras e fatos que você pede para ela lembrar.</p>
        <p><b>Documentos:</b> arquivos que você guarda (como CNH ou comprovantes), armazenados criptografados.</p>
        <p><b>WhatsApp (opcional):</b> seu número e as mensagens que você envia para a Nina por lá.</p>
        <p><b>Pagamento:</b> não guardamos número de cartão nem CPF. Esses dados são digitados direto na página segura do Asaas; nós guardamos apenas o plano e a situação da assinatura.</p>
        <p><b>Técnicos:</b> fuso horário, moeda escolhida, registros de acesso e de erro, e o endereço de notificações do aparelho (se você ativar os avisos).</p>
      </S>

      <S title="2. Para que usamos">
        <p>Para fazer o aplicativo funcionar: registrar e mostrar suas informações, lembrar você de compromissos e contas, calcular quanto você pode gastar, cobrar a assinatura e dar suporte. Não vendemos seus dados e não usamos seus dados para publicidade.</p>
      </S>

      <S title="3. Com quem compartilhamos">
        <p>Somente com os serviços necessários para o Organiza funcionar, que tratam os dados em nosso nome:</p>
        <ul className="list-disc pl-6">
          <li><b>Anthropic</b> (inteligência artificial da Nina) — recebe o texto da mensagem para entender o pedido;</li>
          <li><b>OpenAI</b> — transforma seus áudios em texto;</li>
          <li><b>Meta / WhatsApp</b> — se você conectar o WhatsApp;</li>
          <li><b>Asaas</b> — processamento dos pagamentos;</li>
          <li><b>Netlify</b> e <b>Neon</b> — hospedagem do site e do banco de dados;</li>
          <li><b>Google</b> — se você escolher entrar com a conta Google.</li>
        </ul>
        <p>Alguns desses serviços ficam fora do Brasil; a transferência segue as garantias previstas na LGPD. Se você fizer parte de uma <b>família</b> no Organiza, os itens marcados como compartilhados ficam visíveis para os membros dela.</p>
      </S>

      <S title="4. Segurança">
        <p>A conexão é sempre criptografada (HTTPS), as senhas são cifradas e os documentos são guardados criptografados. Cada pessoa só acessa os próprios dados.</p>
      </S>

      <S title="5. Por quanto tempo guardamos">
        <p>Enquanto a sua conta existir. Quando você exclui a conta, apagamos seus dados de forma definitiva. Registros de pagamento que a lei obriga a manter ficam com o Asaas pelo prazo legal.</p>
      </S>

      <S title="6. Seus direitos">
        <p>Você pode ver e corrigir seus dados no próprio app, pedir para a Nina esquecer qualquer informação em <b>Minha conta</b>, e excluir a conta quando quiser em <Link href="/excluir-conta" className="font-semibold text-accent">meuorganiza.com.br/excluir-conta</Link> ou no app em <b>Minha conta → Excluir minha conta</b>.</p>
        <p>Para outras solicitações (acesso, portabilidade, dúvidas), fale com a gente por {contact}.</p>
      </S>

      <S title="7. Crianças">
        <p>O Organiza é destinado a maiores de 18 anos.</p>
      </S>

      <S title="8. Mudanças">
        <p>Se esta política mudar, atualizamos a data acima e avisamos no aplicativo quando a mudança for importante.</p>
      </S>
    </article>
  );
}
