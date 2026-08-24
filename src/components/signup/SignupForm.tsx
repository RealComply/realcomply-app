"use client";

import { Suspense, useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signup, getInvitePreview, type ActionState, type InvitePreview } from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";

const initialState: ActionState = { error: null };

// Isolated behind its own Suspense boundary so useSearchParams doesn't force
// the whole page out of static prerendering — same pattern as the login
// page's message banner.
function InviteAwareForm({ signupsOpen }: { signupsOpen: boolean }) {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const [invite, setInvite] = useState<InvitePreview>(null);
  const [checkedInvite, setCheckedInvite] = useState(!inviteToken);
  // Whether the person signing up is the licensee in charge. Null until they
  // answer, so the form can require an answer rather than defaulting to one —
  // the default was the bug (see migration 0029): everyone who created an
  // agency was recorded as the licensee whether they were or not.
  const [isLicensee, setIsLicensee] = useState<boolean | null>(null);
  const [state, formAction, pending] = useActionState(signup, initialState);

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    getInvitePreview(inviteToken).then((preview) => {
      if (!cancelled) {
        setInvite(preview);
        setCheckedInvite(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  if (inviteToken && !checkedInvite) {
    return <p className="mt-8 text-sm text-rc-muted">Checking your invite…</p>;
  }

  if (inviteToken && checkedInvite && !invite) {
    return (
      <div className="mt-8 space-y-4">
        <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
          This invite link isn&rsquo;t valid — it may have already been used, been revoked, or the link may be
          incomplete. Ask your licensee to send a new one.
        </p>
        <p className="text-sm text-rc-muted">
          Setting up a brand-new agency instead?{" "}
          <Link href="/signup" className="font-medium text-rc-green-deep hover:underline">
            Start here
          </Link>
        </p>
      </div>
    );
  }


  // Closed to the public, open to invites.
  //
  // Rendered after the invite lookup, never before: an invited person must not
  // be told the door is shut when it is being held open specifically for them.
  // The server refuses independently — see signup() in lib/actions/auth.ts.
  if (!invite && !signupsOpen) {
    return (
      <div className="mt-8 space-y-4">
        <p className="rounded-2xl border border-rc-border bg-rc-bg-alt px-4 py-3 text-sm leading-relaxed text-rc-muted">
          RealComply is invite-only at the moment. If your licensee has sent you a link, open that link and
          you&rsquo;ll come straight in.
        </p>
        <p className="text-sm text-rc-muted">
          Want an account for your agency?{" "}
          <Link href="/#early-access" className="font-medium text-rc-green-deep hover:underline">
            Register your interest
          </Link>{" "}
          and we&rsquo;ll be in touch.
        </p>
        <p className="text-sm text-rc-muted">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-rc-green-deep hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-4">
      {invite && <input type="hidden" name="inviteToken" value={inviteToken ?? ""} />}
      {invite && (
        <p className="rounded-2xl border border-rc-green-deep/30 bg-rc-green-soft px-3 py-2 text-sm text-rc-green-deep">
          You&rsquo;ve been invited to join <span className="font-semibold">{invite.agencyName}</span> as{" "}
          {invite.isLicenseeInCharge ? "a licensee in charge" : "an agent"}.
        </p>
      )}
      {state.error && (
        <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {!invite && (
        <div>
          <label htmlFor="agencyName" className="block text-sm font-medium text-rc-ink">
            Agency name
          </label>
          <input
            id="agencyName"
            name="agencyName"
            type="text"
            required
            placeholder="Cass Property"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
        </div>
      )}
      {/* WHO THE LICENSEE IN CHARGE IS, asked outright.
          Adam, 23 Aug 2026. This used to be an optional "Licensee in charge"
          name and email with the hint "leave blank if that is you" — while
          bootstrap_agency recorded the person signing up as the licensee
          regardless. So an agent who correctly named their principal was also
          recorded as the principal, and nothing could answer the question.

          It matters beyond tidiness: the Settled stage turns on it. Someone who
          is their own licensee should not be asked to send the file to
          themselves, and someone who is not should not be shown a signature
          that is not theirs to give.

          Required on "no", deliberately. The old field was optional so a
          principal with nothing to enter was not blocked — reasoning that only
          held while the app could not tell the two apart. Once they have said
          another person exists, we know we will have to email them and that the
          file cannot close without their signature, so collecting it later is
          just deferring a certainty. */}
      {!invite && (
        <div>
          <fieldset>
            <legend className="block text-sm font-medium text-rc-ink">Are you the licensee in charge?</legend>
            <input type="hidden" name="isLicensee" value={isLicensee === null ? "" : isLicensee ? "yes" : "no"} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsLicensee(true)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isLicensee === true
                    ? "border-rc-green-deep bg-rc-green-soft text-rc-green-deep"
                    : "border-rc-border bg-white text-rc-ink hover:border-rc-green-deep"
                }`}
              >
                <span className="block font-semibold">Yes, that&rsquo;s me</span>
                <span className="mt-0.5 block text-xs text-rc-muted">You sign off the files.</span>
              </button>
              <button
                type="button"
                onClick={() => setIsLicensee(false)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                  isLicensee === false
                    ? "border-rc-green-deep bg-rc-green-soft text-rc-green-deep"
                    : "border-rc-border bg-white text-rc-ink hover:border-rc-green-deep"
                }`}
              >
                <span className="block font-semibold">No, someone else</span>
                <span className="mt-0.5 block text-xs text-rc-muted">You send files to them.</span>
              </button>
            </div>
          </fieldset>

          {isLicensee === false && (
            <div className="mt-3 rounded-lg border border-rc-border bg-rc-bg-alt p-3">
              <label htmlFor="licenseeName" className="block text-sm font-medium text-rc-ink">
                Your licensee in charge
              </label>
              <input
                id="licenseeName"
                name="licenseeName"
                type="text"
                required
                autoComplete="off"
                placeholder="Jane Smith"
                className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
              />
              <input
                id="licenseeEmail"
                name="licenseeEmail"
                type="email"
                required
                placeholder="licensee@youragency.com.au"
                className="mt-2 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-rc-muted">
                Sign-off requests go to this address, and their name goes on the file.
              </p>
            </div>
          )}

          {/* The agency's public website. Asked here for both tiers: an
              individual agent enters their employing agency's site (Adam,
              16 Aug 2026), since the listings are published there either way.
              Used to find each listing's own page for the advertised-price
              check, so nobody pastes a URL per listing. */}
          <label htmlFor="websiteUrl" className="mt-4 block text-sm font-medium text-rc-ink">
            Agency website <span className="font-normal text-rc-muted">(optional)</span>
          </label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            // Plain text, not type="url" — see the note in
            // components/team/LicenseeEmailForm.tsx. The browser's own URL
            // validation rejects a bare domain and its message can't be
            // reworded; normalising server-side accepts what people type.
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="youragency.com.au"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <p className="mt-1 text-xs leading-relaxed text-rc-muted">
            Where your listings are published. Used to check advertised prices against the ESP.
          </p>
        </div>
      )}
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-rc-ink">
          Your name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          required
          className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-rc-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          defaultValue={invite?.email ?? ""}
          readOnly={!!invite}
          className={`mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft ${
            invite ? "bg-rc-bg-alt text-rc-muted" : ""
          }`}
        />
        {invite && <p className="mt-1 text-xs text-rc-faint">This invite was sent to this address specifically.</p>}
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-rc-ink">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
      </div>
      {/* Acceptance of the published documents.
          A real checkbox rather than "by continuing you agree", because what
          gets recorded has to be an act the person took, not an inference from
          them having pressed a button they were going to press anyway. The
          version they accepted is stamped on the record server-side, and the
          links open in a new tab so reading them does not throw away a
          half-filled form. */}
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-rc-muted">
        <input
          type="checkbox"
          name="acceptLegal"
          value="yes"
          required
          className="mt-0.5 shrink-0 accent-rc-green-deep"
        />
        <span>
          I&rsquo;ve read and accept the{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep hover:underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep hover:underline">
            Privacy Policy
          </a>
          .
        </span>
      </label>
      <button
        type="submit"
        disabled={pending || (!invite && isLicensee === null)}
        className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Setting up…" : invite ? "Join the office" : "Create agency"}
      </button>
    </form>
  );
}

export function SignupForm({ signupsOpen }: { signupsOpen: boolean }) {
  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden bg-rc-bg-alt px-4 py-16">
      <div className="rc-mesh-bg" />
      <div className="w-full max-w-sm rounded-card border border-rc-border bg-white p-8 shadow-card-lg">
        <Logo size={22} />
        <p className="mt-1.5 text-sm text-rc-muted">Set up your agency.</p>

        <Suspense fallback={<p className="mt-8 text-sm text-rc-muted">Loading…</p>}>
          <InviteAwareForm signupsOpen={signupsOpen} />
        </Suspense>

        <p className="mt-6 text-sm text-rc-muted">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-rc-green-deep hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
