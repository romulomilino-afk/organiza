import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/session";
import { Onboarding } from "@/components/Onboarding";

export default async function OnboardingPage() {
  const user = await requirePageUser({ allowNotOnboarded: true });
  if (user.onboarded) redirect("/");
  return <Onboarding initialName={user.name ?? ""} />;
}
