import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { currentCpdYear, CPD_HOURS_REQUIRED_AGENT, CPD_UNITS_REQUIRED_ASSISTANT } from "@/lib/cpd-year";
import type { Agency, Breach, Complaint, CpdRecord, Gift, Profile } from "@/lib/types";

const LICENCE_TYPE_LABELS: Record<string, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration",
};

// A plain, printable export of all three registers — same browser
// Print → Save as PDF mechanism as the per-property finalised summary
// (src/app/dashboard/[id]/summary/page.tsx); a polished branded export is a
// later follow-up, not built here.
export default async function RegistersExportPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const cpdYear = currentCpdYear();

  const [{ data: staffRows }, { data: agencyRow }, { data: cpdRows }, { data: giftRows }, { data: complaintRows }, { data: breachRows }] =
    await Promise.all([
      supabase.from("profiles").select("*").order("full_name", { ascending: true }),
      supabase.from("agencies").select("*").eq("id", profile.agency_id).maybeSingle(),
      supabase.from("cpd_records").select("*").gte("completed_date", cpdYear.start).lte("completed_date", cpdYear.end),
      supabase.from("gifts").select("*").order("gift_date", { ascending: false }),
      supabase.from("complaints").select("*").order("received_date", { ascending: false }),
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 print:px-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/registers" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          ← Back to registers
        </Link>
        <button className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600">
          Use your browser&rsquo;s Print → Save as PDF
        </button>
      </div>

      <h1 className="mt-6 text-2xl font-bold text-rc-ink">
        Real<span className="text-rc-green-deep">Comply</span> — Registers export
      </h1>
      <p className="mt-1 text-xs text-rc-faint">
        Generated {new Date().toLocaleString("en-AU")} · {cpdYear.label} CPD year · diligence support — verify with your
        adviser; the licensee decides.
      </p>

      <section className="mt-8">
        <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">Licence register</h2>
        <ul className="mt-2 space-y-1">
          {staff.map((s) => {
            const isAssistant = s.licence_type === "certificate_of_registration";
            const target = isAssistant ? CPD_UNITS_REQUIRED_ASSISTANT : CPD_HOURS_REQUIRED_AGENT;
            const total = (cpdByProfile[s.id] ?? []).reduce((sum, r) => sum + Number(r.hours), 0);
            return (
              <li key={s.id} className="text-sm">
                <span className="font-medium text-rc-ink">{s.full_name ?? s.email}</span>{" "}
                <span className="text-rc-muted">
                  — {s.licence_type ? LICENCE_TYPE_LABELS[s.licence_type] : "no licence on file"}
                  {s.licence_number ? ` · ${s.licence_number}` : ""}
                  {s.licence_expiry ? ` · expires ${s.licence_expiry}` : ""} · CPD {total}/{target}
                  {isAssistant ? "u" : "h"}
                </span>
              </li>
            );
          })}
        </ul>
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
                — {b.category} · {b.severity} · {b.description} · {b.status}
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
