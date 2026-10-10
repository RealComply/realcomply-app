import { Paperclip } from "lucide-react";
import { SignatureBox } from "@/components/registers/SignatureBox";
import { AskToSignButton } from "@/components/registers/AskToSignButton";
import { notNeededReason } from "@/lib/signoff/awaiting";
import type { Profile, SignoffDocument, SignoffSignature } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = {
  sg_manual: "SG Manual",
  trust_reconciliation: "Trust reconciliation",
  other: "Document",
};

// Shared by the Document sign-offs register and the SG Manual page (the
// current version there shows its own sign-off status inline) — one card,
// one signing UI, wherever a signoff_documents row needs showing.
export function DocumentSignoffCard({
  document,
  signatures,
  profiles,
  currentProfile,
  fileUrl,
  ownOnly = false,
  notAsked = [],
}: {
  document: SignoffDocument;
  signatures: SignoffSignature[];
  /** Names only (agency_people): an agent cannot read colleagues' profiles. */
  profiles: Array<{ id: string; full_name: string | null; email?: string | null; archived_at?: string | null }>;
  currentProfile: Profile;
  fileUrl: string | null;
  /** An agent or assistant reads their own signature only (0058), so "1 of 1
   *  signed" would read as everyone done. They see their own status. */
  ownOnly?: boolean;
  /** For the licensee, on the current SG Manual version: present staff with
   *  no row on it, who were never asked to sign (see askStaffToSign). */
  notAsked?: Array<{ id: string; full_name: string | null }>;
}) {
  const nameFor = (id: string) =>
    profiles.find((p) => p.id === id)?.full_name ?? profiles.find((p) => p.id === id)?.email ?? "Unknown";

  // Unsigned rows that nobody is waiting on any more (10 Oct 2026): someone
  // who has left, or a licensee-only document another licensee has signed.
  // Still listed, never counted, so the document can read as done.
  const leftIds = new Set(profiles.filter((p) => p.archived_at).map((p) => p.id));
  const reasonFor = (sig: SignoffSignature) =>
    notNeededReason(sig, document.signer_scope, signatures, leftIds);
  const counted = signatures.filter((s) => reasonFor(s) === null);

  const signedCount = counted.filter((s) => s.signed_at).length;
  // Staff never asked to sign are owed a signature too, so they count against
  // "all signed" rather than letting a five-person office read "1 of 1".
  const total = counted.length + notAsked.length;
  const allSigned = total > 0 && signedCount === total;
  const mine = signatures.find((s) => s.signer_id === currentProfile.id);
  const needsMySignature = !!mine && !mine.signed_at && reasonFor(mine) === null;

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center rounded-full bg-rc-bg-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rc-muted">
            {CATEGORY_LABEL[document.category] ?? "Document"}
            {document.period_label ? ` · ${document.period_label}` : ""}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-rc-ink">{document.title}</p>
          {/* Opens the signed copy once anybody has signed — the document with
              its signature page — and the upload before that. The label says
              which, because "the file" and "the file as signed" are two
              records and a reader is entitled to know which one they opened. */}
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-rc-green-deep hover:underline"
            >
              <Paperclip size={11} />
              {document.signed_file_name ?? document.file_name}
              {document.signed_file_path && (
                <span className="text-rc-faint">· signed copy</span>
              )}
            </a>
          ) : (
            <p className="text-xs text-rc-muted">{document.file_name}</p>
          )}
          {document.notes && <p className="mt-1 text-xs text-rc-muted">{document.notes}</p>}
        </div>
        {ownOnly ? (
          mine && (
            <span
              className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
                needsMySignature ? "bg-rc-amber/15 text-rc-amber-deep" : "bg-rc-green-soft text-rc-green-deep"
              }`}
            >
              {mine.signed_at ? "You signed" : needsMySignature ? "Awaiting your signature" : "Not needed"}
            </span>
          )
        ) : (
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
              allSigned ? "bg-rc-green-soft text-rc-green-deep" : "bg-rc-amber/15 text-rc-amber-deep"
            }`}
          >
            {signedCount} of {total} signed
          </span>
        )}
      </div>

      {!ownOnly && (
        <ul className="mt-3 divide-y divide-rc-border border-t border-rc-border text-sm">
          {signatures.map((sig) => {
            const reason = reasonFor(sig);
            return (
              <li key={sig.id} className="flex items-center justify-between py-1.5">
                <span className={reason ? "text-rc-muted" : "text-rc-ink"}>{nameFor(sig.signer_id)}</span>
                {sig.signed_at ? (
                  <span className="text-xs text-rc-muted">Signed {new Date(sig.signed_at).toLocaleDateString("en-AU")}</span>
                ) : reason === "another_licensee_signed" ? (
                  <span className="text-xs text-rc-faint">Not needed — another licensee signed it off</span>
                ) : reason === "left_the_office" ? (
                  <span className="text-xs text-rc-faint">Left the office — not required</span>
                ) : (
                  <span className="text-xs font-medium text-rc-amber-deep">Outstanding</span>
                )}
              </li>
            );
          })}
          {notAsked.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-1.5">
              <span className="text-rc-ink">{p.full_name ?? "Unknown"}</span>
              <span className="text-xs font-medium text-rc-amber-deep">Not asked to sign this version</span>
            </li>
          ))}
        </ul>
      )}
      {!ownOnly && notAsked.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-rc-muted">
            Not on this version&rsquo;s signer list, so nothing has asked them to sign it. Asking adds
            them; they&rsquo;ll see it on their SG Manual page.
          </p>
          <AskToSignButton documentId={document.id} />
        </div>
      )}
      {ownOnly && mine?.signed_at && (
        <p className="mt-2 text-xs text-rc-muted">Signed {new Date(mine.signed_at).toLocaleDateString("en-AU")}</p>
      )}

      {needsMySignature && <SignatureBox documentId={document.id} />}
    </div>
  );
}
