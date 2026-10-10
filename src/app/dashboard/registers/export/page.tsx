import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireLicenseePage } from "@/lib/data/current-profile";
import { currentCpdYear } from "@/lib/cpd-year";
import { cpdRequirementFor } from "@/lib/rules/nsw-cpd";
import { BREACH_CATEGORY_LABELS } from "@/lib/types";
import type { Agency, Breach, Complaint, CpdRecord, Gift, Profile } from "@/lib/types";
import { countableCpdHours } from "@/lib/cpd-hours";
import { formatAuDateTimeShort } from "@/lib/format-date";
import { PrintButton } from "./PrintButton";

const LICENCE_TYPE_LABELS: Record<string, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration",
};

// A plain, printable export of all three registers, printed or saved as PDF
// from the browser's print dialog (PrintButton opens it). The per-property
// summary has its own PDF route now (src/app/dashboard/[id]/summary/pdf); a
// polished branded export of the registers is a later follow-up, not built
// here.
export default async function RegistersExportPage() {
  // Licensee only (Adam, 7 Oct 2026): a typed address refuses, not just a
  // hidden link.
  const { profile, access } = await requireLicenseePage();
  const supabase = await createClient();
  const cpdYear = currentCpdYear();

  // The complaints register is kept by the licensee in charge of an office
  // only (Adam, 9 Oct 2026), and the database returns no complaints to
  // anyone else, the agent on their own plan included. So for them the
  // section is left out, the same as the Complaints tab: printing "No
  // complaints logged." stated something about a register this account
  // doesn't keep (check of 10 Oct 2026).
  const [{ data: staffRows }, { data: agencyRow }, { data: cpdRows }, { data: giftRows }, { data: complaintRows }, { data: breachRows }] =
    await Promise.all([
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
      supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
      supabase.from("cpd_records").select("*").gte("completed_date", cpdYear.start).lte("completed_date", cpdYear.end),
      supabase.from("gifts").select("*").order("gift_date", { ascending: false }),
      access.officeLicensee
        ? supabase.from("complaints").select("*").order("received_date", { ascending: false })
        : Promise.resolve({ data: [] as Complaint[] }),
      supabase.from("breaches").select("*").order("identified_date", { ascending: false }),
    ]);

  const staff = (staffRows ?? []) as Profile[];
  const agency = agencyRow as Agency | null;
  const gifts = (giftRows ?? []) as Gift[];
  const complaints = (complaintRows ?? []) as Complaint[];
  const breaches = (breachRows ?? []) as Breach[];
  const cpdByProfile: Record<string, CpdRecord[]> = {};
  for (const row of (cpdRows ?? []) as CpdRecord[]) {
    (cpdByProfile[row.profile_id] ??= []).push(row);
  }
  const nameFor = (id: string) => staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "Unknown";

  // The people in the office today, then anyone who has left under "Former
  // staff": the same split as the Licences tab (10 Oct 2026), so the page and
  // the printed register agree on who is on it.
  const currentStaff = staff.filter((s) => !s.archived_at);
  const formerStaff = staff.filter((s) => s.archived_at);
  const licenceRow = (s: Profile) => {
    const requirement = cpdRequirementFor(s.licence_type, s.cpd_practice_category);
    const target = requirement.units ?? requirement.coreHours;
    const total = countableCpdHours(cpdByProfile[s.id] ?? []);
    return (
      <li key={s.id} className="text-sm">
        <span className="font-medium text-rc-ink">{s.full_name ?? s.email}</span>{" "}
        <span className="text-rc-muted">
          — {s.licence_type ? LICENCE_TYPE_LABELS[s.licence_type] : "no licence on file"}
          {s.licence_number ? ` · ${s.licence_number}` : ""}
          {s.licence_expiry ? ` · expires ${s.licence_expiry}` : ""} ·{" "}
          {target === null
            ? `CPD ${total} logged — requirement not established`
            : `CPD ${total}/${target}${requirement.units !== null ? "u" : "h"}`}
          {requirement.forumRequired ? " · Class 1 forum also required" : ""}
        </span>
      </li>
    );
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 print:px-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/registers" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          ← Back to registers
        </Link>
        <PrintButton />
      </div>

      <h1 className="mt-6 text-2xl font-bold text-rc-ink">
        Real<span className="text-rc-green-deep">Comply</span> — Registers export
      </h1>
      {/* Sydney time, named (check, 10 Oct 2026). Left to the runtime it was
          the server's UTC: the wrong time all day, and before 11 am the
          wrong date on a printed register. */}
      <p className="mt-1 text-xs text-rc-faint">
        Generated {formatAuDateTimeShort(new Date().toISOString())} · {cpdYear.label} CPD year · diligence support — verify with your
        adviser; the licensee decides.
      </p>

      <section className="mt-8">
        <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">Licence register</h2>
        <ul className="mt-2 space-y-1">{currentStaff.map(licenceRow)}</ul>
        {formerStaff.length > 0 && (
          <>
            <h3 className="mt-4 text-xs font-semibold text-rc-muted">Former staff</h3>
            <ul className="mt-1 space-y-1">{formerStaff.map(licenceRow)}</ul>
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">Insurance register</h2>
        {agency && (
          <ul className="mt-2 space-y-1">
            <li className="text-sm">
              <span className="font-medium text-rc-ink">Professional indemnity:</span>{" "}
              <span className="text-rc-muted">
                {agency.pi_insurer
                  ? `${agency.pi_insurer} · ${agency.pi_policy_number ?? "no policy #"} · expires ${agency.pi_expiry ?? "—"}`
                  : "not on file"}
              </span>
            </li>
            <li className="text-sm">
              <span className="font-medium text-rc-ink">Cybersecurity:</span>{" "}
              <span className="text-rc-muted">
                {agency.cyber_insurer
                  ? `${agency.cyber_insurer} · ${agency.cyber_policy_number ?? "no policy #"} · expires ${agency.cyber_expiry ?? "—"}`
                  : "not on file"}
              </span>
            </li>
            <li className="text-sm">
              <span className="font-medium text-rc-ink">iCare workers:</span>{" "}
              <span className="text-rc-muted">
                {agency.icare_insurer
                  ? `${agency.icare_insurer} · ${agency.icare_policy_number ?? "no policy #"} · expires ${agency.icare_expiry ?? "—"}`
                  : "not on file"}
              </span>
            </li>
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">Gifts &amp; benefits register</h2>
        <ul className="mt-2 space-y-1">
          {gifts.length === 0 && <li className="text-sm text-rc-muted">No entries.</li>}
          {gifts.map((g) => (
            <li key={g.id} className="text-sm">
              <span className="font-medium text-rc-ink">{g.gift_date}</span>{" "}
              <span className="text-rc-muted">
                — {nameFor(g.profile_id)} · {g.description} ({g.direction}){g.value ? ` · ~$${g.value}` : ""} · {g.status}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {access.officeLicensee && (
        <section className="mt-8">
          <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">Complaints register</h2>
          <ul className="mt-2 space-y-1">
            {complaints.length === 0 && <li className="text-sm text-rc-muted">No complaints logged.</li>}
            {complaints.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-medium text-rc-ink">{c.received_date}</span>{" "}
                <span className="text-rc-muted">
                  — {c.complainant} · {c.nature} · {c.status}
                  {c.resolved_date ? ` (resolved ${c.resolved_date})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">
          Breach &amp; corrective-actions register
        </h2>
        <ul className="mt-2 space-y-1">
          {breaches.length === 0 && <li className="text-sm text-rc-muted">No breaches logged.</li>}
          {breaches.map((b) => (
            <li key={b.id} className="text-sm">
              <span className="font-medium text-rc-ink">{b.identified_date}</span>{" "}
              <span className="text-rc-muted">
                — {BREACH_CATEGORY_LABELS[b.category] ?? b.category} · {b.severity} · {b.description} · {b.status}
                {b.corrective_action ? ` · action: ${b.corrective_action}` : " · no corrective action recorded"}
                {b.notifiable ? (b.notified_date ? ` · notified ${b.notified_date}` : " · NOTIFICATION OUTSTANDING") : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-xs text-rc-faint">
        Prepared for {profile.full_name ?? profile.email}. This record reflects diligence-support content maintained
        in RealComply and is not legal advice.
      </p>
    </main>
  );
}
