"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";
import type { Profile } from "@/lib/types";

const LINKS = [
  { href: "/dashboard/home", label: "Home" },
  { href: "/dashboard/portfolio", label: "Portfolio" },
  { href: "/dashboard/licensee", label: "Licensee digest" },
  { href: "/dashboard/registers", label: "Registers" },
  { href: "/dashboard/training", label: "Training" },
  { href: "/dashboard/sg-manual", label: "SG Manual" },
  { href: "/dashboard/team", label: "Team" },
];

export function TopNav({ profile }: { profile: Profile }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-rc-border bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
        <Link href="/dashboard" className="shrink-0">
          <Logo size={17} />
        </Link>

        <nav className="ml-2 flex flex-1 items-center gap-1 overflow-x-auto text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`shrink-0 rounded-full px-3 py-1.5 font-medium transition ${
                  active ? "bg-rc-green-soft text-rc-green-deep" : "text-rc-muted hover:bg-neutral-100 hover:text-rc-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3 text-sm">
          <div className="hidden items-center gap-2 sm:flex">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-rc-ink-bg text-[11px] font-bold text-white"
              aria-hidden="true"
            >
              {(profile.full_name ?? profile.email).charAt(0).toUpperCase()}
            </span>
            <span className="text-rc-ink">{profile.full_name ?? profile.email}</span>
            {profile.is_licensee_in_charge && (
              <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-xs font-medium text-rc-green-deep">
                Licensee in charge
              </span>
            )}
          </div>
          <form action={logout}>
            <button type="submit" className="rounded-full border border-rc-border px-3 py-1.5 font-medium text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
