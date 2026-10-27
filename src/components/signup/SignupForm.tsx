"use client";

import { Suspense, useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  signup,
  getInvitePreview,
  checkFounderInvite,
  checkFounderInviteFree,
  type ActionState,
  type InvitePreview,
} from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";
import { ENTITY_NAME_LABEL, ENTITY_NAME_MAX, ENTITY_NAME_SIGNUP_HINT } from "@/lib/agency-names";

const initialState: ActionState = { error: null };

// Isolated behind its own Suspense boundary so useSearchParams doesn't force
// the whole page out of static prerendering — same pattern as the login
// page's message banner.
function InviteAwareForm({ signupsOpen }: { signupsOpen: boolean }) {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  // A FOUNDER invite — permission to set up an agency of their own while public
  // signups stay shut (0045). Not to be confused with ?invite= above, which
  // joins an agency that already exists. Adam, 9 Sep 2026, wanting friends at
  // other offices on free accounts: putting them in HIS agency would have shown
  // them Cass's listings and trust records, and opening signups would have let
  // in everybody else too.
  const founderToken = searchParams.get("founder");
  const [founderOk, setFounderOk] = useState(false);
  // A personal invite ticked "Free account" (0098): no trial, no card.
  const [founderFree, setFounderFree] = useState(false);
  const [checkedFounder, setCheckedFounder] = useState(!founderToken);
  const [invite, setInvite] = useState<InvitePreview>(null);
  const [checkedInvite, setCheckedInvite] = useState(!inviteToken);
  // Whether the person signing up is the licensee in charge. Null until they
  // answer, so the form can require an answer rather than defaulting to one —
  // the default was the bug (see migration 0029): everyone who created an
  // agency was recorded as the licensee whether they were or not.
  const [isLicensee, setIsLicensee] = useState<boolean | null>(null);
  const [state, formAction, pending] = useActionState(signup, initialState);
  // What was typed, back from a refused sign-up (23 Oct 2026). React empties
  // the form after every submit; these defaults are what it refills it with.
  const kept = state.values;

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

  useEffect(() => {
    if (!founderToken) return;
    let cancelled = false;
    Promise.all([checkFounderInvite(founderToken), checkFounderInviteFree(founderToken)]).then(([ok, free]) => {
      if (!cancelled) {
        setFounderOk(ok);
        setFounderFree(ok && free);
        setCheckedFounder(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [founderToken]);

  if ((inviteToken && !checkedInvite) || (founderToken && !checkedFounder)) {
    return <p className="mt-8 text-sm text-rc-muted">Checking your invite…</p>;
  }

  // A founder link that has been used, expired, or mistyped. Said plainly, and
  // without offering "start a new agency instead" — that route is shut, and
  // sending them at a door that will refuse them is worse than saying so here.
  if (founderToken && checkedFounder && !founderOk) {
    return (
      <div className="mt-8 space-y-4">
        <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
          This invite link isn&rsquo;t valid — each one works once, and this one has either been used already
          or expired. Ask for a fresh link.
        </p>
      </div>
    );
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
  if (!invite && !founderOk && !signupsOpen) {
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
        {/* No "Already set up? Sign in" here — the card this sits inside
            carries that line on every state, and duplicating it showed the
            same sentence twice on the closed-signup page (Adam, 8 Sep 2026). */}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-4">
      {invite && <input type="hidden" name="inviteToken" value={inviteToken ?? ""} />}
      {founderOk && <input type="hidden" name="founderToken" value={founderToken ?? ""} />}
      {founderOk && founderFree && (
        <p className="rounded-2xl border border-rc-green-deep/30 bg-rc-green-soft px-3 py-2 text-sm text-rc-green-deep">
          You&rsquo;ve been invited to set up your own agency on RealComply, as a{" "}
          <span className="font-semibold">free account</span>. There&rsquo;s no trial and no card details to enter.
        </p>
      )}
      {founderOk && !founderFree && (
        <p className="rounded-2xl border border-rc-green-deep/30 bg-rc-green-soft px-3 py-2 text-sm text-rc-green-deep">
          You&rsquo;ve been invited to set up your own agency on RealComply. It starts with a{" "}
          <span className="font-semibold">14-day free trial</span>. You&rsquo;ll enter card details on Stripe&rsquo;s
          page to start it, and nothing is charged until the trial ends.
        </p>
      )}
      {invite && (
        <p className="rounded-2xl border border-rc-green-deep/30 bg-rc-green-soft px-3 py-2 text-sm text-rc-green-deep">
          You&rsquo;ve been invited to join <span className="font-semibold">{invite.agencyName}</span> as{" "}
          {invite.joiningAs}.
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
            defaultValue={kept?.agencyName}
            placeholder="Cass Property"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
        </div>
      )}
      {/* The company on the corporation licence, when it isn't the trading
          name (brief, 14 Oct 2026, Part 4). Optional, every sign-up path that
          sets up an office: office plans, early access, agents on their own
          plan. The same field as Office profile. */}
      {!invite && (
        <div>
          <label htmlFor="licensedEntityName" className="block text-sm font-medium text-rc-ink">
            {ENTITY_NAME_LABEL} <span className="font-normal text-rc-faint">(optional)</span>
          </label>
          <input
            id="licensedEntityName"
            name="licensedEntityName"
            type="text"
            maxLength={ENTITY_NAME_MAX}
            autoComplete="organization"
            defaultValue={kept?.licensedEntityName}
            placeholder="Example Holdings Pty Ltd"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <p className="mt-1 text-xs text-rc-faint">{ENTITY_NAME_SIGNUP_HINT}</p>
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
                defaultValue={kept?.licenseeName}
                placeholder="Jane Smith"
                className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
              />
              <input
                id="licenseeEmail"
                name="licenseeEmail"
                type="email"
                required
                defaultValue={kept?.licenseeEmail}
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
          {/* Was "Agency website (optional)". Renamed and required, 23 Oct
              2026 (Adam): we need the page their listings are on. */}
          <label htmlFor="websiteUrl" className="mt-4 block text-sm font-medium text-rc-ink">
            Link to the page with your listings
          </label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            required
            // Plain text, not type="url" — see the note in
            // components/team/LicenseeEmailForm.tsx. The browser's own URL
            // validation rejects a bare domain and its message can't be
            // reworded; normalising server-side accepts what people type.
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={kept?.websiteUrl}
            placeholder="youragency.com.au/buy"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <p className="mt-1 text-xs leading-relaxed text-rc-muted">
            The page on your agency&rsquo;s website that shows your listings for sale. Used to check advertised
            prices against the estimated selling price.
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
          defaultValue={kept?.fullName}
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
          defaultValue={invite?.email ?? kept?.email ?? ""}
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
          aria-invalid={state.passwordError ? true : undefined}
          aria-describedby={state.passwordError ? "password-error" : undefined}
          className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
        {/* A password Supabase refused, in plain words (23 Oct 2026). See
            lib/auth/password-refusal.ts. */}
        {state.passwordError && (
          <p id="password-error" role="alert" className="mt-1.5 text-xs leading-relaxed text-rc-amber-deep">
            {state.passwordError}
          </p>
        )}
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
          defaultChecked={kept?.acceptLegal}
          className="mt-0.5 shrink-0 accent-rc-green-deep"
        />
        <span>
          I&rsquo;ve read and accept the{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-rc-green-deep hover:underline">
            Terms and Conditions
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
