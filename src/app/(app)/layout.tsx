import { requirePageAccess } from "@/lib/session";
import { TrialBanner } from "@/components/TrialBanner";
import { BottomNav } from "@/components/BottomNav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, access } = await requirePageAccess();
  return (
    <>
      <main className="mx-auto min-h-dvh max-w-xl px-4 pt-5 pb-28"><TrialBanner access={access} timezone={user.timezone} />{children}</main>
      <BottomNav />
    </>
  );
}
