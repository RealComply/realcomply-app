import { logout } from "@/lib/actions/auth";
import { ACK_INTRO, ACK_TITLE } from "@/lib/agent-acknowledgement";
import { AcknowledgementForm } from "@/components/onboarding/AcknowledgementForm";
import type { Profile } from "@/lib/types";

// "Before you start" (job 7 brief, Part 1): for an agent on their own plan,
// once, straight after sign-up (once their trial has started and the plan is
// known to be theirs), before they can use the app. The dashboard layout
// shows it in place of every page until it is confirmed, like the trial
// start page before it. RealComply never emails or contacts their licensee.

export function BeforeYouStartView({
  profile,
  agencyName,
  licenseeName,
  licenseeLicenceNumber,
  date,
}: {
  profile: Profile;
  agencyName: string;
  licenseeName: string;
  licenseeLicenceNumber: string;
  date: string;
}) {
  return (
    <div className="min-h-screen bg-rc-bg-alt">
      <header className="flex flex-wrap items-center gap-3 bg-rc-ink-bg px-4 py-3 text-white">
        <span className="text-lg font-bold">
          Real<span className="text-rc-green">Comply</span>
        </span>
        <span className="ml-auto flex min-w-0 flex-wrap items-center gap-3 text-xs text-rc-ink-muted">
          <span className="min-w-0 break-words">{profile.full_name ?? profile.email}</span>
          <form action={logout}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </span>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="rounded-card border border-rc-border bg-white p-5 shadow-card sm:p-6">
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">{ACK_TITLE}</h1>
          <p className="mt-2 text-sm leading-relaxed text-rc-muted">{ACK_INTRO}</p>
          <AcknowledgementForm
            agencyName={agencyName}
            licenseeName={licenseeName}
            licenseeLicenceNumber={licenseeLicenceNumber}
            date={date}
          />
        </div>
      </main>
    </div>
  );
}
