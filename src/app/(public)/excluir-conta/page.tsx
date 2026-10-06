import Link from "next/link";
import { auth } from "@/auth";
import { DeleteAccountForm } from "@/components/DeleteAccountForm";

export const metadata = { title: "Excluir conta · Organiza" };

export default async function DeleteAccountPage() {
  const session = await auth();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[32px] font-bold leading-tight">Excluir minha conta</h1>
        <p className="mt-2 text-ink-2">Ao excluir a conta do Organiza, apagamos de forma definitiva:</p>
      </div>
      <ul className="card flex list-disc flex-col gap-1.5 pl-9 text-[15px]">
        <li>seus dados de cadastro (nome, e-mail, senha e telefone do WhatsApp);</li>
        <li>gastos, receitas, fixos, categorias, cartões e parcelas;</li>
        <li>tarefas, agenda, lembretes, prazos e listas de compras;</li>
        <li>documentos e arquivos guardados;</li>
        <li>conversas com a Nina e o que ela aprendeu sobre você.</li>
      </ul>
      <p className="text-[15px] text-ink-2">
        A assinatura paga é cancelada na hora e não haverá novas cobranças. Os registros de pagamentos que a lei
        obriga a guardar ficam apenas com o Asaas, nosso processador de pagamentos. Se você for o dono de uma família,
        a família também é desfeita.
      </p>
      <div className="card flex flex-col gap-3">
        {session?.user ? (
          <>
            <p className="text-[15px]">Você está conectado como <b>{session.user.email}</b>.</p>
            <DeleteAccountForm />
          </>
        ) : (
          <>
            <p className="text-[15px]">Para excluir, entre na sua conta. Depois você volta direto para esta página.</p>
            <Link href="/login?callbackUrl=/excluir-conta" className="btn w-full text-center">Entrar para excluir</Link>
            <p className="text-sm text-ink-3">No aplicativo, o caminho é: <b>Minha conta → Excluir minha conta</b>.</p>
          </>
        )}
      </div>
    </div>
  );
}
