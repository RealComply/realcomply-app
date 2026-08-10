import { Paperclip } from "lucide-react";
import { SignatureBox } from "@/components/registers/SignatureBox";
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
}: {
  document: SignoffDocument;
  signatures: SignoffSignature[];
  profiles: Profile[];
  currentProfile: Profile;
  fileUrl: string | null;
}) {
  const nameFor = (id: string) =>
    profiles.find((p) => p.id === id)?.full_name ?? profiles.find((p) => p.id === id)?.email ?? "Unknown";

  const signedCount = signatures.filter((s) => s.signed_at).length;
  const total = signatures.length;
  const allSigned = total > 0 && signedCount === total;
  const mine = signatures.find((s) => s.signer_id === currentProfile.id);
  const needsMySignature = !!mine && !mine.signed_at;

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center rounded-full bg-rc-bg-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rc-muted">
            {CATEGORY_LABEL[document.category] ?? "Document"}
            {document.period_label ? ` · ${document.period_label}` : ""}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-rc-ink">{document.title}</p>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-rc-green-deep hover:underline"
            >
              <Paperclip size={11} /> {document.file_name}
            </a>
          ) : (
            <p className="text-xs text-rc-muted">{document.file_name}</p>
          )}
          {document.notes && <p className="mt-1 text-xs text-rc-muted">{document.notes}</p>}
        </div>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
            allSigned ? "bg-rc-green-soft text-rc-green-deep" : "bg-rc-amber/15 text-rc-amber-deep"
          }`}
        >
          {signedCount} of {total} signed
        </span>
      </div>

      <ul className="mt-3 divide-y divide-rc-border border-t border-rc-border text-sm">
        {signatures.map((sig) => (
          <li key={sig.id} className="flex items-center justify-between py-1.5">
            <span className="text-rc-ink">{nameFor(sig.signer_id)}</span>
            {sig.signed_at ? (
              <span className="text-xs text-rc-muted">Signed {new Date(sig.signed_at).toLocaleDateString("en-AU")}</span>
            ) : (
              <span className="text-xs font-medium text-rc-amber-deep">Outstanding</span>
            )}
          </li>
        ))}
      </ul>

      {needsMySignature && <SignatureBox documentId={document.id} />}
    </div>
  );
}
