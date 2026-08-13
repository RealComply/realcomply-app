import { logout } from "@/lib/actions/auth";
import type { Profile } from "@/lib/types";

// The right-hand end of the old TopNav — who you're signed in as, and the way
// out — kept exactly where it was when navigation moved to the left sidebar
// (Adam, 13 Aug 2026: "your name and role stay put"). Rendered once by the
// dashboard layout rather than by each page.

// Every profile gets a role line, not just licensees — previously an ordinary
// agent's header showed a name and nothing else, so there was no visual "this
// is who, this is what they are" distinction to make. Mirrors the labelling
// used in the staff register (LICENCE_TYPE_LABELS in StaffRegisterCard.tsx /
// registers export) so the wording is consistent with how roles are described
// everywhere else in the app.
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

export function UserBar({ profile }: { profile: Profile }) {
  return (
    <header className="rc-app-chrome sticky top-0 z-20 flex items-center justify-end gap-4 border-b border-rc-border bg-white/85 px-4 py-3 backdrop-blur-md sm:px-6">
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
        <button
          type="submit"
          className="rounded-full border border-rc-border px-3.5 py-2 text-sm font-medium text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
        >
          Sign out
        </button>
      </form>
    </header>
  );
}
