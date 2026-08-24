import Link from "next/link";
import { Plus } from "lucide-react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { UserMenu } from "@/components/UserMenu";
import type { Profile } from "@/lib/types";

// The top bar.
//
// It used to hold a name and a Sign out button, both right-aligned, on a strip
// that runs the full width of every page in the app. Adam, 24 Aug 2026, after
// the CRM interface research: the sidebar is right, the top bar was the wasted
// opportunity. It now carries the three things that belong in chrome —
// somewhere to search from, somewhere to start a listing from, and who you are.
//
// Left to right: search, "New listing", identity. That order is not arbitrary:
// search is the thing used most and reading starts on the left; the primary
// action sits next to the identity where a primary action normally lives.

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
  const name = profile.full_name ?? profile.email;
  const role = roleLabel(profile);

  return (
    // pl-16 on mobile clears the sidebar's floating menu button, which is
    // fixed at left-3 top-3 and would otherwise sit on top of the search field.
    <header className="rc-app-chrome sticky top-0 z-20 flex items-center gap-3 border-b border-rc-border bg-white/85 py-3 pl-16 pr-4 backdrop-blur-md md:pl-6 md:pr-6">
      <GlobalSearch isAssistant={Boolean(profile.is_assistant)} />

      <Link
        href="/dashboard/new"
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
      >
        <Plus size={15} strokeWidth={2.6} aria-hidden="true" />
        {/* The label is the first thing to go on a narrow screen, not the
            button. An icon-only "+" next to a search field still reads as
            "add", and losing the action entirely on a phone would be worse. */}
        <span className="hidden sm:inline">New listing</span>
        <span className="sr-only sm:hidden">New listing</span>
      </Link>

      {/* Identity stays on screen at desktop widths rather than hiding behind
          the avatar, which is what it did before and what Adam asked for on
          13 Aug. The menu holds the actions. */}
      <div className="hidden flex-col leading-tight lg:flex">
        <span className="text-[15px] font-semibold text-rc-ink">{name}</span>
        <span
          className={`text-xs font-medium ${
            profile.is_licensee_in_charge ? "text-rc-green-deep" : "text-rc-muted"
          }`}
        >
          {role}
        </span>
      </div>

      <UserMenu
        name={name}
        role={role}
        isLicensee={profile.is_licensee_in_charge}
        initial={name.charAt(0).toUpperCase()}
      />
    </header>
  );
}
