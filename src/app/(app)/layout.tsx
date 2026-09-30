import { requirePageUser } from "@/lib/session";
import { BottomNav } from "@/components/BottomNav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser();
  return (
    <>
      <main className="mx-auto min-h-dvh max-w-xl px-4 pt-5 pb-28">{children}</main>
      <BottomNav />
    </>
  );
}
