import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { getConfig } from "@/lib/config";
import { currentUser } from "@/lib/auth/current";
import { listUsers } from "@/lib/services/engine";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, runtime } = await currentUser();
  const sellers = listUsers(runtime.db, user.org_id);
  return (
    <Shell user={user} sellers={sellers} demoMode={getConfig().demoMode}>
      {children}
    </Shell>
  );
}
