import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { recentMessages } from "@/lib/data/queries";
import { activeConversationId } from "@/lib/data/user-setup";
import { toChatMessage } from "@/lib/nina";
import { hasFeature } from "@/lib/plans";
import { llmEnabled } from "@/lib/nina/llm";
import { ChatView } from "@/components/ChatView";
import { PageHeader } from "@/components/ui";

export default async function NinaPage() {
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const conv = await activeConversationId(db, user.id);
  const msgs = (await recentMessages(db, user.id, conv, 60)).map(toChatMessage);
  const ai = llmEnabled();
  return (
    <>
      <PageHeader title="Nina" subtitle="Sua assistente de organização"
        right={<span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-3">
          <i className={`h-[7px] w-[7px] rounded-full ${ai ? "bg-good" : "bg-ink-3"}`} />{ai ? "IA ativa" : "Modo simples"}</span>} />
      <ChatView initial={msgs} name={user.name?.split(" ")[0] ?? ""} canVoice={hasFeature(access.plan, "audio")} />
    </>
  );
}
