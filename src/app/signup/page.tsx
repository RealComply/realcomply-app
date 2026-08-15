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
function InviteAwareForm() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const [invite, setInvite] = useState<InvitePreview>(null);
  const [checkedInvite, setCheckedInvite] = useState(!inviteToken);
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
      {/* Licensee in charge email, captured once at agency setup (Adam,
          15 Aug 2026). It is what sign-off links are sent to, and asking here
          rather than per listing was his call — one licensee supervises
          everything in the agencies this is aimed at.

          Optional on purpose. A principal who is their own licensee has no
          second address to give, and blocking signup over a field that only
          matters at Stage 5 would cost real signups to save a later prompt.
          Left blank, the sign-off step asks for it when it is first needed.

          Not shown on an invite signup: the person joining an existing agency
          is not setting that agency up, and letting them overwrite the
          licensee's address would be an obvious way to redirect sign-off
          links away from the person who is supposed to receive them. */}
      {!invite && (
        <div>
          <label htmlFor="licenseeEmail" className="block text-sm font-medium text-rc-ink">
            Licensee in charge email <span className="font-normal text-rc-muted">(optional)</span>
          </label>
          <input
            id="licenseeEmail"
            name="licenseeEmail"
            type="email"
            placeholder="licensee@youragency.com.au"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <p className="mt-1 text-xs leading-relaxed text-rc-muted">
            Where sign-off requests go. Leave blank if that is you.
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
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Setting up…" : invite ? "Join the office" : "Create agency"}
      </button>
    </form>
  );
}

export default function SignupPage() {
  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden bg-rc-bg-alt px-4 py-16">
      <div className="rc-mesh-bg" />
      <div className="w-full max-w-sm rounded-card border border-rc-border bg-white p-8 shadow-card-lg">
        <Logo size={22} />
        <p className="mt-1.5 text-sm text-rc-muted">Set up your agency.</p>

        <Suspense fallback={<p className="mt-8 text-sm text-rc-muted">Loading…</p>}>
          <InviteAwareForm />
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
