"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";
import type { Profile } from "@/lib/types";

const LINKS = [
  { href: "/dashboard/home", label: "Home" },
  { href: "/dashboard/portfolio", label: "Office overview" },
  { href: "/dashboard/registers", label: "Registers" },
  { href: "/dashboard/training", label: "Training" },
  { href: "/dashboard/sg-manual", label: "SG Manual" },
  { href: "/dashboard/document-signoffs", label: "Sign-offs" },
  { href: "/dashboard/team", label: "Team" },
];

// Every profile gets a role line now, not just licensees — previously an
// ordinary agent's header showed a name and nothing else, so there was no
// visual "this is who, this is what they are" distinction to make. Mirrors
// the labelling already used in the staff register (LICENCE_TYPE_LABELS in
// StaffRegisterCard.tsx / registers export) so the wording is consistent
// with how roles are described everywhere else in the app.
function roleLabel(profile: Profile): string {
  if (profile.is_licensee_in_charge) return "Licensee in charge";
  switch (profile.licence_type) {
    case "class_1":
      return "Class 1 agent";
    case "class_2":
      return "Class 2 agent";
    case "certificate_of_registration":
      return "Assistant agent";
    default:
      return profile.is_agent ? "Agent" : "Team member";
  }
}

export function TopNav({ profile }: { profile: Profile }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-rc-border bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
        <Link href="/dashboard" className="shrink-0">
          <Logo size={20} />
        </Link>

        <nav className="ml-2 flex flex-1 items-center gap-1.5 overflow-x-auto text-[15px]">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`shrink-0 rounded-full px-3.5 py-2 font-medium transition ${
                  active
                    ? "bg-rc-green-soft text-rc-green-deep shadow-[inset_0_0_0_1px_rgba(12,166,120,0.18)]"
                    : "text-rc-muted hover:bg-neutral-100 hover:text-rc-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-4 text-sm">
          <div className="hidden items-center gap-3 sm:flex">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
              style={{ background: "linear-gradient(155deg, #1d3a31 0%, #0d1f19 100%)" }}
              aria-hidden="true"
            >
              {(profile.full_name ?? profile.email).charAt(0).toUpperCase()}
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[15px] font-semibold text-rc-ink">{profile.full_name ?? profile.email}</span>
              <span
                className={`text-xs font-medium ${
                  profile.is_licensee_in_charge ? "text-rc-green-deep" : "text-rc-muted"
                }`}
              >
                {roleLabel(profile)}
              </span>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="rounded-full border border-rc-border px-3.5 py-2 font-medium text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
