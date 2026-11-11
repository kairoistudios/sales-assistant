"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/briefing", label: "Briefing" },
  { href: "/loops", label: "Loops" },
  { href: "/accounts", label: "Accounts" },
  { href: "/mail", label: "Mail" },
  { href: "/notes", label: "Notes" },
  { href: "/audit", label: "Audit" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ direction = "col" }: { direction?: "col" | "row" }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex gap-1", direction === "row" ? "overflow-x-auto" : "flex-col")}>
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm whitespace-nowrap",
              active ? "bg-white/15 text-white" : "text-[#d9d0c2] hover:bg-white/10",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
