import Link from "next/link";
import type { ReactNode } from "react";
import { signInDemo, signOut } from "@/app/actions";
import type { UserRow } from "@/lib/services/engine";
import { Nav } from "./nav";

export function Shell({
  user,
  sellers,
  demoMode,
  children,
}: {
  user: UserRow;
  sellers: UserRow[];
  demoMode: boolean;
  children: ReactNode;
}) {
  const others = sellers.filter((seller) => seller.id !== user.id);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="px-5 pt-7 pb-6">
          <Link href="/briefing" className="serif block text-3xl leading-none">
            Ledger
          </Link>
          <p className="mt-2 text-xs tracking-wide text-[#c9bfb0]">Turb0 · suggest only</p>
        </div>
        <div className="px-3">
          <Nav />
        </div>
        <SellerFooter user={user} others={others} demoMode={demoMode} />
      </aside>
      <div className="min-w-0">
        <header className="border-b border-white/10 bg-sidebar px-4 py-3 text-sidebar-foreground md:hidden">
          <div className="mb-3 flex items-baseline justify-between">
            <Link href="/briefing" className="serif text-2xl">
              Ledger
            </Link>
            <span className="text-xs">{user.name.split(" ")[0]}</span>
          </div>
          <Nav direction="row" />
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6 md:px-10 md:py-10">{children}</main>
      </div>
    </div>
  );
}

function SellerFooter({ user, others, demoMode }: { user: UserRow; others: UserRow[]; demoMode: boolean }) {
  return (
    <div className="mt-auto px-5 py-6 text-sm">
      <p className="font-medium">{user.name}</p>
      <p className="text-[#c9bfb0]">{user.email}</p>
      {demoMode && others.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-[#c9bfb0]">Switch seller</p>
          {others.map((seller) => (
            <form key={seller.id} action={signInDemo}>
              <input type="hidden" name="email" value={seller.email} />
              <button className="text-left text-[#f4efe6] underline decoration-white/30 underline-offset-4" type="submit">
                {seller.name}
              </button>
            </form>
          ))}
        </div>
      )}
      <form action={signOut} className="mt-4">
        <button className="text-xs text-[#c9bfb0]" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
