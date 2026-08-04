"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { ComplianceItem } from "@/lib/rules/nsw-sales";
import type { Profile, PropertyItem } from "@/lib/types";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  setItemStatus,
  addReviewEntry,
  addOfferEntry,
  recordReduction,
  recordSale,
  signItem,
  sendToLicensee,
  generateExport,
  uploadEvidence,
  removeEvidence,
  type ActionState,
} from "@/lib/actions/compliance";

const initialState: ActionState = { error: null };
const EVIDENCE_BUCKET = "compliance-evidence";

function StatusPill({ status }: { status?: PropertyItem["status"] }) {
  if (!status || status === "open") {
    return (
      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">
        Open
      </span>
    );
  }
  if (status === "flagged") {
    return (
      <span className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep">
        Flagged
      </span>
    );
  }
  return (
    <span className="rounded-full bg-rc-green/15 px-2.5 py-0.5 text-xs font-medium text-rc-green-deep">
      Done
    </span>
  );
}

function ItemShell({
  item,
  status,
  propertyId,
  current,
  children,
}: {
  item: ComplianceItem;
  status?: PropertyItem["status"];
  propertyId: string;
  current?: PropertyItem;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-rc-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-rc-ink">{item.label}</h3>
            {item.licenseeOnly && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Licensee
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-500">{item.description}</p>
          {item.legalBasis && (
            <p className="mt-1 text-xs text-neutral-400">{item.legalBasis}</p>
          )}
        </div>
        <StatusPill status={status} />
      </div>
      <div className="mt-3">{children}</div>
      <EvidenceUploader
        key={current?.evidence_path ?? "none"}
        propertyId={propertyId}
        itemKey={item.key}
        evidencePath={current?.evidence_path ?? null}
        evidenceFileName={(current?.data as { evidenceFileName?: string } | undefined)?.evidenceFileName}
      />
    </div>
  );
}

function FieldError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-sm text-rc-amber-deep">{error}</p>;
}

// Evidence attachment — one file per item, uploaded to a private Supabase
// Storage bucket (supabase/migrations/0002_evidence_storage.sql). Shown on
// every item kind since evidence can apply broadly (a signed agreement, a
// pool certificate, a comparable-sales report), not just the "evidence"
// items in the rules file. Signed URLs are fetched client-side so they're
// generated fresh per view rather than baked into server-rendered HTML.
function EvidenceUploader({
  propertyId,
  itemKey,
  evidencePath,
  evidenceFileName,
}: {
  propertyId: string;
  itemKey: string;
  evidencePath: string | null;
  evidenceFileName?: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const uploadAction = uploadEvidence.bind(null, propertyId, itemKey);
  const [uploadState, uploadFormAction, uploadPending] = useActionState(uploadAction, initialState);
  const removeAction = removeEvidence.bind(null, propertyId, itemKey);

  useEffect(() => {
    if (!evidencePath) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(evidencePath, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [evidencePath]);

  return (
    <div className="mt-3 border-t border-rc-border pt-3">
      <p className="text-xs font-medium text-neutral-500">Evidence</p>
      {evidencePath ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-rc-green-deep hover:underline"
            >
              📎 {evidenceFileName ?? "View file"}
            </a>
          ) : (
            <span className="text-neutral-400">📎 {evidenceFileName ?? "file"} (loading link…)</span>
          )}
          <form action={removeAction}>
            <button
              type="submit"
              className="text-xs text-neutral-400 transition hover:text-rc-amber-deep hover:underline"
            >
              Remove
            </button>
          </form>
        </div>
      ) : (
        <form action={uploadFormAction} className="mt-1 flex flex-wrap items-center gap-2">
          <input
            type="file"
            name="file"
            required
            className="text-xs text-neutral-500 file:mr-2 file:rounded-md file:border file:border-rc-border file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium"
          />
          <button
            type="submit"
            disabled={uploadPending}
            className="rounded-md border border-rc-border px-2 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-60"
          >
            {uploadPending ? "Uploading…" : "Attach file"}
          </button>
        </form>
      )}
      <FieldError error={uploadState.error} />
    </div>
  );
}

// Default: `checklist` kind — mark done/flag, optional note + date. a4
// (the ESP) additionally captures structured low/high figures, since the
// live underquoting checks elsewhere need real numbers, not free text.
function ChecklistItem({
  item,
  propertyId,
  current,
}: {
  item: ComplianceItem;
  propertyId: string;
  current?: PropertyItem;
}) {
  const boundAction = setItemStatus.bind(null, propertyId, item.key);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as {
    note?: string;
    espLow?: number;
    espHigh?: number;
    aiDraft?: { note?: string; espLow?: number; espHigh?: number; eventDate?: string };
  };
  const draft = data.aiDraft;

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-3">
        {draft && (
          <p className="rounded-md bg-rc-green/10 px-2 py-1.5 text-xs text-rc-green-deep">
            🤖 Pre-filled from an uploaded document — check it against the source, then save.
          </p>
        )}
        {item.key === "a4" && (
          <div className="flex gap-3">
            <div>
              <label className="block text-xs text-neutral-500">ESP low</label>
              <input
                type="number"
                name="espLow"
                defaultValue={data.espLow ?? draft?.espLow ?? ""}
                className="mt-1 w-32 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500">ESP high (optional)</label>
              <input
                type="number"
                name="espHigh"
                defaultValue={data.espHigh ?? draft?.espHigh ?? ""}
                className="mt-1 w-32 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
          </div>
        )}
        {item.requiresDate && (
          <div>
            <label className="block text-xs text-neutral-500">Event date</label>
            <input
              type="date"
              name="eventDate"
              defaultValue={current?.event_date ?? draft?.eventDate ?? ""}
              className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
            />
          </div>
        )}
        {!item.hideNote && (
          <div>
            <label className="block text-xs text-neutral-500">Note</label>
            <textarea
              name="note"
              defaultValue={data.note ?? draft?.note ?? ""}
              rows={2}
              className="mt-1 w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            name="status"
            value="done"
            disabled={pending}
            className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            Mark done
          </button>
          <button
            type="submit"
            name="status"
            value="flagged"
            disabled={pending}
            className="rounded-md border border-rc-amber-deep/40 px-3 py-1.5 text-xs font-semibold text-rc-amber-deep transition hover:bg-rc-amber/10 disabled:opacity-60"
          >
            Flag
          </button>
          <button
            type="submit"
            name="status"
            value="open"
            disabled={pending}
            className="rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-50 disabled:opacity-60"
          >
            Reopen
          </button>
        </div>
      </form>
      <FieldError error={state.error} />
    </ItemShell>
  );
}

// c1 — the live underquoting check: advertised guide vs the recorded ESP
// (a4). This is the product's core "don't just tick it, compute it" USP —
// the flag fires from real numbers, not a static checkbox (the prohibited-
// term and spread checks run server-side in setItemStatus).
function GuideItem({
  item,
  propertyId,
  current,
  espItem,
}: {
  item: ComplianceItem;
  propertyId: string;
  current?: PropertyItem;
  espItem?: PropertyItem;
}) {
  const boundAction = setItemStatus.bind(null, propertyId, item.key);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as { note?: string; flagReasons?: string[] };
  const esp = (espItem?.data ?? {}) as { espLow?: number; espHigh?: number };

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      {esp.espLow == null ? (
        <p className="text-sm text-neutral-500">Record the ESP (item a4) first — the live check needs it.</p>
      ) : (
        <p className="text-xs text-neutral-400">Recorded ESP: ${esp.espLow.toLocaleString()}
          {esp.espHigh && esp.espHigh !== esp.espLow ? ` – $${esp.espHigh.toLocaleString()}` : ""}
        </p>
      )}
      <form action={formAction} className="mt-2 space-y-3">
        <div className="flex gap-3">
          <input type="number" name="guideLow" placeholder="Guide low" className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm" />
          <input type="number" name="guideHigh" placeholder="Guide high (optional)" className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm" />
        </div>
        <textarea name="note" defaultValue={data.note ?? ""} placeholder="Exact wording used in the ad" rows={2} className="w-full rounded-md border border-rc-border px-2 py-1 text-sm" />
        <div className="flex gap-2">
          <button type="submit" name="status" value="done" disabled={pending} className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
            Record guide
          </button>
        </div>
      </form>
      <FieldError error={state.error} />
      {data.flagReasons && data.flagReasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-rc-amber-deep">
          {data.flagReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

function ReviewLogItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = addReviewEntry.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const entries = ((current?.data ?? {}) as { entries?: Array<{ note: string; recordedAt: string }> }).entries ?? [];

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="flex gap-2">
        <input
          type="text"
          name="note"
          placeholder="e.g. reviewed against 3 new comparables, ESP still holds"
          className="flex-1 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          Log review
        </button>
      </form>
      <FieldError error={state.error} />
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-neutral-600">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-rc-border pt-2">
              <span className="text-xs text-neutral-400">
                {new Date(e.recordedAt).toLocaleDateString("en-AU")}
              </span>{" "}
              — {e.note}
            </li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

function OffersLogItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = addOfferEntry.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as {
    entries?: Array<{
      amount: number;
      outcome: string;
      vendorInformed: boolean;
      belowFloor: boolean;
      note: string;
      recordedAt: string;
    }>;
    flagReason?: string;
  };
  const entries = data.entries ?? [];

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-2 rounded-md bg-neutral-50 p-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="number"
            name="amount"
            placeholder="Offer amount"
            className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
          <select name="outcome" className="rounded-md border border-rc-border px-2 py-1 text-sm">
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="vendorInformed" /> Vendor informed in writing
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="belowFloor" /> Below the vendor&rsquo;s written offer-floor instruction (exempt)
        </label>
        <textarea
          name="note"
          placeholder="Note"
          rows={2}
          className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          Log offer
        </button>
      </form>
      <FieldError error={state.error} />
      {data.flagReason && (
        <p className="mt-2 text-sm text-rc-amber-deep">{data.flagReason}</p>
      )}
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-neutral-600">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-rc-border pt-2">
              <span className="font-medium text-rc-ink">${e.amount.toLocaleString()}</span> — {e.outcome}
              {e.vendorInformed ? " · vendor informed" : " · vendor not yet informed"}
              {e.note && <> — {e.note}</>}
            </li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

function ReductionItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = recordReduction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const entries = ((current?.data ?? {}) as { entries?: Array<Record<string, unknown>> }).entries ?? [];

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-2 rounded-md bg-neutral-50 p-3">
        <textarea
          name="reason"
          placeholder="Reason for the reduction"
          rows={2}
          className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="espAdjusted" /> This also revises the ESP
        </label>
        <div className="flex gap-2">
          <input type="number" name="newEspLow" placeholder="New ESP low" className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm" />
          <input type="number" name="newEspHigh" placeholder="New ESP high" className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="vendorNotified" /> Vendor notified in writing
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input type="checkbox" name="agreementAmended" /> Agreement amended
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          Log reduction
        </button>
      </form>
      <FieldError error={state.error} />
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-neutral-600">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-rc-border pt-2">
              {String(e.reason)} {e.espAdjusted ? "· ESP revised" : ""}
            </li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

function SaleItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = recordSale.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as { price?: number; outsideRange?: boolean; flagReason?: string };

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="flex gap-2">
        <input
          type="number"
          name="price"
          defaultValue={data.price ?? ""}
          placeholder="Final sale price"
          className="w-48 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          Record
        </button>
      </form>
      <FieldError error={state.error} />
      {data.flagReason && <p className="mt-2 text-sm text-rc-amber-deep">{data.flagReason}</p>}
    </ItemShell>
  );
}

function SignItem({ item, propertyId, current, profile }: { item: ComplianceItem; propertyId: string; current?: PropertyItem; profile: Profile }) {
  const boundAction = signItem.bind(null, propertyId, item.key);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as { typedName?: string; signedAt?: string };

  if (item.licenseeOnly && !profile.is_licensee_in_charge) {
    return (
      <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
        <p className="text-sm text-neutral-500">Waiting on the licensee in charge to sign.</p>
      </ItemShell>
    );
  }

  if (data.signedAt) {
    return (
      <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
        <p className="text-sm text-neutral-600">
          Signed <span className="font-medium text-rc-ink">{data.typedName}</span> on{" "}
          {new Date(data.signedAt).toLocaleString("en-AU")}
        </p>
      </ItemShell>
    );
  }

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="flex gap-2">
        <input
          type="text"
          name="typedName"
          placeholder="Type your full name"
          className="flex-1 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          Adopt as signature
        </button>
      </form>
      <FieldError error={state.error} />
    </ItemShell>
  );
}

function SendItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const action = sendToLicensee.bind(null, propertyId);
  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      {current?.status === "done" ? (
        <p className="text-sm text-neutral-500">Marked sent.</p>
      ) : (
        <form action={action}>
          <button
            type="submit"
            className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Mark sent to licensee
          </button>
        </form>
      )}
    </ItemShell>
  );
}

function ExportItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const action = generateExport.bind(null, propertyId);
  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      {current?.status === "done" ? (
        <p className="text-sm text-neutral-500">
          Generated {new Date((current.data as { generatedAt?: string }).generatedAt ?? current.created_at).toLocaleString("en-AU")}.{" "}
          <a href={`/dashboard/${propertyId}/summary`} className="text-rc-green-deep hover:underline">
            View the finalised summary
          </a>
        </p>
      ) : (
        <form action={action}>
          <button
            type="submit"
            className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Generate finalised file
          </button>
        </form>
      )}
    </ItemShell>
  );
}

export function ItemCard({
  item,
  propertyId,
  current,
  profile,
  allItems,
}: {
  item: ComplianceItem;
  propertyId: string;
  current?: PropertyItem;
  profile: Profile;
  allItems: Record<string, PropertyItem>;
}) {
  switch (item.kind) {
    case "review":
      return <ReviewLogItem item={item} propertyId={propertyId} current={current} />;
    case "offers":
      return <OffersLogItem item={item} propertyId={propertyId} current={current} />;
    case "reduction":
      return <ReductionItem item={item} propertyId={propertyId} current={current} />;
    case "sale":
      return <SaleItem item={item} propertyId={propertyId} current={current} />;
    case "sign":
      return <SignItem item={item} propertyId={propertyId} current={current} profile={profile} />;
    case "send":
      return <SendItem item={item} propertyId={propertyId} current={current} />;
    case "export":
      return <ExportItem item={item} propertyId={propertyId} current={current} />;
    case "guide":
      return <GuideItem item={item} propertyId={propertyId} current={current} espItem={allItems["a4"]} />;
    case "checklist":
    default:
      return <ChecklistItem item={item} propertyId={propertyId} current={current} />;
  }
}
