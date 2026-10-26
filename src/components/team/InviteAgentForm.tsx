"use client";

import { useActionState, useState } from "react";
import { Copy, Check, UserPlus } from "lucide-react";
import { inviteAgent } from "@/lib/actions/team";
import { officeManagerWording } from "@/lib/office-manager/card";
import type { InviteOption, InviteRole } from "@/lib/team/invite-options";
import type { Profile } from "@/lib/types";

type InviteState = { error: string | null; inviteLink?: string };
const initialState: InviteState = { error: null };

// There's no outbound email sending yet (see tech-stack-notes.md — Workspace
// email migration is still an open thread), so this doesn't pretend to
// "send an invite." It generates the signup link and hands it to the
// licensee to send themselves — same manual-relay shape as everything else
// in this app until real email delivery is wired up.
// Roles, 20 Aug 2026. This replaced a single "also a licensee in charge"
// tick, which could only ever describe two of the three people who work in an
// office. An assistant is the third: they prepare files for one or more
// agents and cannot sign them.
//
// Five roles since 0095 (mockup approved by Adam, 26 Oct 2026): Agent,
// Assistant, Licensee in charge, Office manager, Property manager. Which of
// them this person may choose is lib/team/invite-options.ts; the database
// checks the same. Licensee in charge is only the licensee named in Office
// profile, where they aren't on RealComply yet (an office manager inviting
// them); otherwise handing over stays Change licensee in charge on Office
// profile (Adam, 16 Oct 2026; 0080).

export function InviteAgentForm({
  agents,
  options,
  officeName,
  licensee,
}: {
  agents: Profile[];
  options: InviteOption[];
  officeName: string;
  /** As recorded in Office profile. */
  licensee: { name: string | null; email: string | null };
}) {
  const [state, formAction, pending] = useActionState(inviteAgent, initialState);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<InviteRole>("agent");
  const [fullName, setFullName] = useState("");
  const [authorised, setAuthorised] = useState(false);

  async function copyLink() {
    if (!state.inviteLink) return;
    await navigator.clipboard.writeText(state.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const notes = options.filter((o) => !o.available && o.note);
  const asLicensee = role === "licensee_in_charge";
  const asOfficeManager = role === "office_manager";
  const licenseeName = licensee.name?.trim() || licensee.email?.trim() || "your licensee in charge";
  const licenseeFirst = licenseeName.split(/\s+/)[0];
  const personName = fullName.trim();
  const blocked = pending || (asOfficeManager && (!authorised || !personName));

  return (
    <div className="rounded-card border border-dashed border-rc-border bg-rc-bg-alt p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rc-green-soft text-rc-green-deep">
          <UserPlus size={16} />
        </span>
        <h3 className="text-sm font-semibold text-rc-ink">Invite someone</h3>
      </div>
      <p className="mt-1.5 text-xs text-rc-muted">
        Creates a sign-up link for this office and this email address. Send it to them yourself, by text or email.
        They join your office when they sign up.
      </p>

      <form action={formAction} className="mt-3 space-y-3">
        {!asLicensee && (
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              name="email"
              placeholder="Their email"
              aria-label="Their email"
              required
              className="w-56 rounded-lg border border-rc-border px-2.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
            <input
              type="text"
              name="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={asOfficeManager ? "Full name (needed)" : "Full name (optional)"}
              aria-label={asOfficeManager ? "Full name, needed for an office manager" : "Full name, optional"}
              required={asOfficeManager}
              className="w-48 rounded-lg border border-rc-border px-2.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </div>
        )}

        <fieldset>
          <legend className="text-xs font-medium text-rc-ink">What do they do here?</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {options.map((o) => {
              const chosen = role === o.role;
              return (
                <label
                  key={o.role}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                    !o.available
                      ? "cursor-not-allowed border-dashed border-rc-border bg-neutral-100 text-rc-muted"
                      : chosen
                        ? "cursor-pointer border-rc-green-deep bg-rc-green-soft text-rc-green-deep"
                        : "cursor-pointer border-rc-border bg-white text-rc-ink hover:border-rc-green"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={o.role}
                    checked={chosen}
                    disabled={!o.available}
                    onChange={() => {
                      setRole(o.role);
                      setAuthorised(false);
                    }}
                    className="sr-only"
                  />
                  {o.label}
                  <span className="mt-0.5 block text-[11px] font-normal leading-snug text-rc-muted">{o.hint}</span>
                </label>
              );
            })}
          </div>
          {notes.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {notes.map((o) => (
                <p key={o.role} className="rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-rc-muted">
                  <span className="font-semibold text-rc-ink">{o.label}:</span> {o.note}
                </p>
              ))}
            </div>
          )}
        </fieldset>

        {/* Which agents an assistant supports. This IS their access — the
            listings they can see are exactly the ones belonging to the people
            ticked here, so it is asked at invite time rather than left to be
            configured afterwards and forgotten. */}
        {role === "assistant" && (
          <div className="rounded-lg border border-rc-border bg-white px-3 py-2.5">
            <p className="text-xs font-medium text-rc-ink">Which agents do they support?</p>
            {agents.length === 0 ? (
              <p className="mt-1 text-[11px] text-rc-amber-deep">
                There are no agents in the office yet. Add one before inviting an assistant.
              </p>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-xs text-rc-ink">
                    <input type="checkbox" name="supportsAgentIds" value={a.id} className="accent-rc-green-deep" />
                    {a.full_name ?? a.email}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-rc-muted">
              They&rsquo;ll see only these agents&rsquo; listings, not the rest of the office. You can change it any
              time.
            </p>
          </div>
        )}

        {/* The licensee named in Office profile, exactly as recorded, and
            nobody else (Adam, 26 Oct 2026). The database writes them onto
            the invite whatever is sent. */}
        {asLicensee && (
          <div className="rounded-lg border border-rc-green-deep/25 bg-rc-green-soft/50 px-3 py-3">
            <p className="text-sm font-bold text-rc-ink">Invite {licenseeName}, your licensee in charge</p>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-rc-muted">Name</dt>
              <dd className="font-semibold text-rc-ink">{licensee.name?.trim() || "Not recorded"}</dd>
              <dt className="text-rc-muted">Email</dt>
              <dd className="font-semibold text-rc-ink">{licensee.email?.trim()}</dd>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-rc-muted">
              Taken from Office profile, and can&rsquo;t be changed here. Only the licensee in charge can change them. If
              they&rsquo;re wrong, email{" "}
              <a href="mailto:admin@realcomply.com.au" className="font-semibold text-rc-green-deep underline">
                admin@realcomply.com.au
              </a>{" "}
              and we&rsquo;ll correct them.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-rc-ink">
              When {licenseeFirst} joins, they&rsquo;re licensee in charge on RealComply. Price statements, file
              sign-offs and the SG annexure then happen in the app, not by email link. Your office manager approval stays
              as it is, and {licenseeFirst} can withdraw it in Team.
            </p>
          </div>
        )}

        {asOfficeManager && (
          <div className="rounded-lg border border-rc-green-deep/25 bg-rc-green-soft/50 px-3 py-3">
            <p className="text-sm font-bold text-rc-ink">{personName || "They"} join{personName ? "s" : ""} as office manager</p>
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">
              {personName || "They"} will look after Team, Office profile, registers, CPD, training, trust records, the
              SG Manual and billing. Price statement approvals, file sign-offs, annexure adoption, changing the licensee
              in charge and deleting compliance records stay with you.
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm font-semibold text-rc-ink">
              <input
                type="checkbox"
                name="authorise"
                value="yes"
                checked={authorised}
                disabled={!personName}
                onChange={(e) => setAuthorised(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-rc-green-deep"
              />
              <span>{officeManagerWording(personName || "[their full name]", officeName)}</span>
            </label>
            <p className="mt-2 text-[11px] leading-relaxed text-rc-muted">
              {personName ? personName.split(/\s+/)[0] : "They"} become{personName ? "s" : ""} office manager when they
              join. Your approval, the date and the wording go on the record in Team and Sign-offs. You can withdraw it at
              any time in Team.
            </p>
          </div>
        )}

        {role === "property_manager" && (
          <div className="rounded-lg border border-rc-border bg-white px-3 py-2.5">
            <p className="text-xs font-semibold text-rc-ink">{personName || "They"} join{personName ? "s" : ""} as a property manager</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-rc-muted">
              <li>Property management comes first in their menu.</li>
              <li>
                Their licence category starts as Residential property management, which sets their CPD. They can change
                it on their CPD page.
              </li>
              <li>They can still list and sell, like any agent.</li>
            </ul>
          </div>
        )}

        <button
          type="submit"
          disabled={blocked}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Creating link…" : asLicensee ? `Create invite link for ${licenseeFirst}` : "Create invite link"}
        </button>
        {asOfficeManager && !pending && (!personName || !authorised) && (
          <p className="text-[11px] text-rc-muted">
            {personName ? "The button works once the box is ticked." : "Add their full name first. It goes in the words you approve."}
          </p>
        )}
        {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
      </form>

      {state.inviteLink && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rc-green-deep/30 bg-white px-3 py-2 text-xs">
          <span className="flex-1 truncate text-rc-ink">{state.inviteLink}</span>
          <button
            type="button"
            onClick={copyLink}
            className="flex shrink-0 items-center gap-1 rounded-full bg-rc-green-soft px-2.5 py-1 font-semibold text-rc-green-deep transition hover:opacity-80"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
