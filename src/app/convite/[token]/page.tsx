import Link from "next/link";
import { requirePageUser } from "@/lib/session";
import { getDb } from "@/db";
import { findInvite, memberCount } from "@/lib/family";
import { getAccess } from "@/lib/access";
import { acceptInviteAction } from "@/actions/family";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requirePageUser({ allowNotOnboarded: true });
  const db = getDb();
  const inv = await findInvite(db, token);
  const access = await getAccess(db, user);

  let body: React.ReactNode;
  if (!inv) body = <><h1 className="text-[30px] font-bold">Convite inválido</h1><p className="text-ink-2">Esse link expirou ou já foi usado. Peça um novo a quem te convidou.</p><Link href="/" className="btn w-fit">Ir para o início</Link></>;
  else if (access.household?.id === inv.household.id) body = <><h1 className="text-[30px] font-bold">Você já está na {inv.household.name}</h1><Link href="/familia" className="btn w-fit">Ver família</Link></>;
  else if (access.household) body = <><h1 className="text-[30px] font-bold">Você já tem uma família</h1><p className="text-ink-2">Saia da {access.household.name} antes de entrar na {inv.household.name}.</p><Link href="/familia" className="btn w-fit">Ver minha família</Link></>;
  else if ((await memberCount(db, inv.household.id)) >= PLANS.FAMILY.maxMembers) body = <><h1 className="text-[30px] font-bold">Família completa</h1><p className="text-ink-2">A {inv.household.name} já tem {PLANS.FAMILY.maxMembers} pessoas.</p></>;
  else body = (
    <>
      <h1 className="text-[32px] font-bold leading-tight">Entrar na {inv.household.name}?</h1>
      <p className="text-lg text-ink-2">Vocês vão compartilhar a lista de compras, compromissos e tarefas da família. O resto continua só seu.</p>
      <form action={acceptInviteAction.bind(null, token)}><button className="btn w-full py-4 text-[17px]">Entrar na família</button></form>
      <Link href="/" className="text-center text-sm font-semibold text-ink-3">Agora não</Link>
    </>
  );
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-4 py-10">{body}</main>;
}
