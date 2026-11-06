import { getDb } from "@/db";
import { requirePageAccess } from "@/lib/session";
import { cardTrial, trialEligible } from "@/lib/billing";
import { TrialBanner } from "@/components/TrialBanner";
import { PixDueBanner } from "@/components/PixDueBanner";
import { BottomNav } from "@/components/BottomNav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, access } = await requirePageAccess();
  const db = getDb();
  const solo = access.plan === access.ownPlan;
  const [ct, canTrial] = solo ? await Promise.all([cardTrial(db, user).catch(() => null), user.plan === "FREE" ? trialEligible(db, user.id).catch(() => false) : false]) : [null, false];
  return (
    <>
      <main className="mx-auto min-h-dvh max-w-xl px-4 pt-5 pb-28"><TrialBanner access={access} timezone={user.timezone} cardTrial={ct} canTrial={canTrial} /><PixDueBanner user={user} />{children}</main>
      <BottomNav />
    </>
  );
}
