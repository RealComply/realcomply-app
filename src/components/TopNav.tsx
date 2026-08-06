import Link from "next/link";
import { logout } from "@/lib/actions/auth";
import type { Profile } from "@/lib/types";

export function TopNav({ profile }: { profile: Profile }) {
  return (
    <header className="border-b border-rc-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/dashboard" className="text-lg font-bold text-rc-ink">
          Real<span className="text-rc-green-deep">Comply</span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-neutral-600">
          <Link href="/dashboard/licensee" className="hover:text-rc-ink hover:underline">
            Licensee digest
          </Link>
          <Link href="/dashboard/registers" className="hover:text-rc-ink hover:underline">
            Registers
          </Link>
          <Link href="/dashboard/training" className="hover:text-rc-ink hover:underline">
            Training
          </Link>
          <span>
            {profile.full_name ?? profile.email}
            {profile.is_licensee_in_charge && (
              <span className="ml-2 rounded-full bg-rc-green/15 px-2 py-0.5 text-xs font-medium text-rc-green-deep">
                Licensee in charge
              </span>
            )}
          </span>
          <form action={logout}>
            <button type="submit" className="hover:text-rc-ink hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
