// The "Before you start" screen for an agent on their own plan, and the
// annexure lock (job 7 brief, 14 Oct 2026; mockup approved by Adam; 0071).
// The words, in one place: the screen, the stored record and the PDF all
// read them from here. Pure: no database.
//
// What the agent confirms is stored with the record word for word (wording
// version and the full text of the five boxes), so a later change to the
// wording never changes what someone confirmed. Change the wording here and
// bump ACK_VERSION.

import { EMPTY_FILE_MESSAGE } from "@/lib/storage/file-check";

export const ACK_VERSION = "1.0";

export const ACK_TITLE = "Before you start";
export const ACK_INTRO =
  "You're using RealComply on your own plan, so your agency's records are in your hands. Please confirm the following.";

/** A run of a statement, italic for the Act's name. */
export type AckRun = { text: string; italic?: boolean };

const ACT = "Property and Stock Agents Act 2002";

/** The five boxes, exactly as shown. */
export const ACK_STATEMENTS: AckRun[][] = [
  [
    { text: "I hold a current licence or certificate of registration under the " },
    { text: ACT, italic: true },
    { text: " (NSW), and I work under the licensee in charge and at the agency named above." },
  ],
  [
    {
      text: "The records I put into RealComply, including information about vendors and purchasers, belong to my agency and its clients.",
    },
  ],
  [
    {
      text: "My licensee in charge remains responsible for supervising my work. I understand RealComply supports that supervision and does not replace it.",
    },
  ],
  [
    {
      text: "If I stop working at this agency I will tell RealComply, and I understand the agency may ask for its records and for my access to them to end.",
    },
  ],
  [
    {
      text: "Before I add my first listing to RealComply, I will give my licensee in charge a copy of the RealComply Supervision Guidelines Annexure and have them complete and sign the section headed “Adoption by the licensee in charge”.",
    },
  ],
];

/** One statement as plain text: what is stored and printed. */
export function statementText(runs: AckRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** The five, as plain text, in order. */
export const ACK_STATEMENT_TEXTS: string[] = ACK_STATEMENTS.map(statementText);

export const ACK_LABELS = {
  agentLicence: "Your licence or certificate number",
  agency: "Agency",
  licensee: "Licensee in charge",
  licenseeLicence: "Licensee's licence number",
  typedName: "Your full name",
  date: "Date",
  button: "Confirm and continue",
} as const;

export type AckFields = {
  agentLicenceNumber: string;
  agencyName: string;
  licenseeName: string;
  licenseeLicenceNumber: string;
  typedName: string;
};

export const ACK_LIMITS = { licence: 40, agency: 300, name: 200, typedName: 120 } as const;

/** Trimmed, single-spaced. */
export function tidy(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * What stops the form being confirmed, or null when it can be: every field
 * filled, within its length, and all five boxes ticked. The same check runs
 * in the browser (to grey the button) and on the server.
 */
export function ackProblem(fields: AckFields, ticked: boolean[]): string | null {
  const f = {
    agentLicenceNumber: tidy(fields.agentLicenceNumber),
    agencyName: tidy(fields.agencyName),
    licenseeName: tidy(fields.licenseeName),
    licenseeLicenceNumber: tidy(fields.licenseeLicenceNumber),
    typedName: tidy(fields.typedName),
  };
  if (Object.values(f).some((v) => v === "")) return "Fill in every field.";
  if (f.agentLicenceNumber.length > ACK_LIMITS.licence || f.licenseeLicenceNumber.length > ACK_LIMITS.licence) {
    return `A licence number is at most ${ACK_LIMITS.licence} characters.`;
  }
  if (f.agencyName.length > ACK_LIMITS.agency || f.licenseeName.length > ACK_LIMITS.name) {
    return "One of the names is too long.";
  }
  if (f.typedName.length < 2 || f.typedName.length > ACK_LIMITS.typedName) return "Type your full name.";
  if (ticked.length !== ACK_STATEMENTS.length || ticked.some((t) => !t)) return "Tick every box.";
  return null;
}

// ── The lock ──────────────────────────────────────────────────────────────

// CHANGE (Adam, 23 Oct 2026, trial brief; 0087). WAS: the lock held back
// every listing, the first included, so this copy said "your first listing".
// NOW: the first listing is free of the lock (all plans), so the lock only
// ever shows once an office already has a listing, and the copy says "more
// listings" / "second listing". The rule itself is the database's
// (listing_gate_reason); nothing here decides it.

/**
 * Why this office can't add a listing yet (0071 my_listing_gate), or null.
 * 'signed_annexure': an agent's own plan, until the signed annexure is
 * uploaded. 'annexure': an office plan, until the licensee in charge adopts it.
 */
export type ListingGate = "signed_annexure" | "annexure" | null;

export function listingGateFrom(value: unknown): ListingGate {
  return value === "signed_annexure" || value === "annexure" ? value : null;
}

/** "your licensee in charge" when no name is on file. */
export function licenseeOrDefault(name: string | null | undefined): string {
  return tidy(name) || "your licensee in charge";
}

export type LockCopy = { pill: string; text: string; action: "upload" | "review_and_sign" | null };

/**
 * What Listings shows in place of Add listing, by who is looking. Exact
 * wording from the brief (Parts 4 and 5) and the mockup's pills.
 */
export function lockCopy(
  gate: Exclude<ListingGate, null>,
  viewer: { actsAsLicensee: boolean },
  licenseeName: string | null | undefined,
): LockCopy {
  const who = licenseeOrDefault(licenseeName);
  if (gate === "signed_annexure") {
    return {
      pill: "Waiting on the signed annexure",
      text: `Upload the annexure signed by ${who} first, then you can add more listings. Everything else in RealComply works as normal.`,
      // Someone assisting the agent can't upload it; the agent can.
      action: viewer.actsAsLicensee ? "upload" : null,
    };
  }
  if (viewer.actsAsLicensee) {
    return {
      pill: "Waiting on the annexure",
      text: "Adopt RealComply’s annexure to your Supervision Guidelines, then you can add more listings. Everything else works as normal.",
      action: "review_and_sign",
    };
  }
  const named = tidy(licenseeName);
  return {
    pill: "Waiting on your licensee",
    text: named
      ? `Waiting on ${named}, your licensee in charge, to adopt RealComply’s annexure to your Supervision Guidelines. You can add more listings once they have.`
      : "Waiting on your licensee in charge to adopt RealComply’s annexure to your Supervision Guidelines. You can add more listings once they have.",
    action: null,
  };
}

/** The message createProperty returns when the lock is on. */
export function lockedCreateMessage(gate: Exclude<ListingGate, null>): string {
  return gate === "signed_annexure"
    ? "Waiting on the signed annexure. Upload the annexure signed by your licensee in charge first, then you can add more listings."
    : "Waiting on the annexure. More listings can be added once your licensee in charge has adopted RealComply’s annexure.";
}

// ── The Home card (agent's own plan) ─────────────────────────────────────

export const HOME_CARD_TITLE = "Before your second listing: get your licensee’s sign-off";

export function homeCardText(licenseeName: string | null | undefined): string {
  const who = tidy(licenseeName) || "your licensee in charge";
  return `Give this to ${who} and ask them to complete and sign the section headed “Adoption by the licensee in charge”. It explains how RealComply fits within your agency’s supervision system.`;
}

export const DOWNLOAD_LABEL = "Download the annexure (PDF)";
export const UPLOAD_LABEL = "Upload the signed annexure";
export const UPLOAD_HINT = "PDF, JPG or PNG. A phone photo of the signed page is fine. Saved in Registers, Document sign-offs.";

// ── The signed annexure upload ────────────────────────────────────────────

const SIGNED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** The type to store an upload under, or null when it isn't a PDF, JPG or PNG. */
export function signedAnnexureType(file: { name: string; type: string }): string | null {
  if (Object.values(SIGNED_TYPES).includes(file.type)) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return SIGNED_TYPES[ext] ?? null;
}

/** The plain reason a file can't be uploaded as the signed annexure, or null. */
export function signedAnnexureProblem(file: { name: string; type: string; size: number }, maxBytes: number): string | null {
  if (signedAnnexureType(file) === null) return "Upload a PDF, JPG or PNG.";
  if (file.size > maxBytes) return `This file is over ${Math.round(maxBytes / (1024 * 1024))} MB. Please upload a smaller copy.`;
  if (file.size === 0) return EMPTY_FILE_MESSAGE;
  return null;
}

export const SIGNED_ANNEXURE_TITLE = "Signed SG annexure (licensee adoption)";
export const ACK_DOCUMENT_TITLE = "Agent acknowledgement";
