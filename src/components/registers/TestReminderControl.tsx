"use client";

import { useState } from "react";
import { sendTestLicenceReminder } from "@/lib/actions/licences";

// "Send me a test reminder", for the licensee in charge.
//
// The daily job only proves itself when a real date comes due, which can be
// months away. This sends the same two emails now, labelled as a test: the
// holder's version to the chosen team member and the licensee's copy to the
// licensee. Nothing is recorded as a sent reminder, so the real schedule is
// untouched.
export function TestReminderControl({ members }: { members: { id: string; name: string }[] }) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    if (!memberId) return;
    setSending(true);
    setResult(null);
    const r = await sendTestLicenceReminder(memberId);
    setSending(false);
    if (r.error) {
      setResult({ ok: false, text: r.error });
    } else {
      const failed = r.failedTo?.length ? ` It didn't reach ${r.failedTo.join(", ")}.` : "";
      setResult({ ok: !failed, text: `Test sent to ${(r.sentTo ?? []).join(" and ")}.${failed}` });
    }
  }

  if (members.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-rc-muted">Check a reminder reaches someone:</span>
      <select
        value={memberId}
        onChange={(e) => setMemberId(e.target.value)}
        className="rounded-md border border-rc-border bg-white px-2 py-0.5 text-xs"
        aria-label="Team member to send a test reminder to"
      >
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={send}
        disabled={sending}
        className="rounded-md border border-rc-border bg-white px-2 py-0.5 text-xs font-medium text-rc-green-deep hover:bg-rc-green-soft disabled:opacity-60"
      >
        {sending ? "Sending…" : "Send a test reminder"}
      </button>
      <span className="text-rc-faint">Goes to them and to you. Nothing is recorded as a real reminder.</span>
      {result && <span className={result.ok ? "text-rc-green-deep" : "text-rc-amber-deep"}>{result.text}</span>}
    </div>
  );
}
