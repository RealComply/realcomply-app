// What happened the last time the contract was read (Adam, 5 Nov 2026). Kept
// on the contract card (b1) as data.contractRead, and carried through Mark
// done there, the same as the comparable-sales report's on its card
// (lib/documents/report-read.ts).
//
// The contract is read the moment it's attached, with no button to press.
// Before, a read that failed on attach was recorded and emailed to Adam but
// said nothing on the card, so the prescribed-documents list simply never
// appeared. Now the card says so, plainly.

export type ContractReadOutcome = "read" | "failed" | "wrong_document";

export type ContractRead = {
  /** When it was read. */
  at: string;
  /** The file that was read: a note about an earlier file is not shown. */
  path: string;
  outcome: ContractReadOutcome;
  /** Prescribed documents found, out of those checked. */
  found?: number;
  checked?: number;
  /** Plain words: why a read failed. */
  message?: string;
};

type PatchLike = {
  itemKey: string;
  prescribedDocs?: { found: boolean }[];
  notAContract?: boolean;
  wrongDocument?: unknown;
};

/** The outcome of a read of the contract that finished, from what it returned. */
export function contractReadFrom(patches: PatchLike[], path: string, at: string): ContractRead {
  const own = patches.filter((p) => p.itemKey === "b1");
  if (own.some((p) => p.wrongDocument || p.notAContract)) return { at, path, outcome: "wrong_document" };
  const docs = own.flatMap((p) => p.prescribedDocs ?? []);
  return { at, path, outcome: "read", found: docs.filter((d) => d.found).length, checked: docs.length };
}

export function contractReadFailed(message: string, path: string, at: string): ContractRead {
  return { at, path, outcome: "failed", message };
}

/** The outcome kept on the contract card, for the file attached there now. */
export function contractReadOf(data: unknown, evidencePath: string | null | undefined): ContractRead | null {
  const r = (data as { contractRead?: ContractRead } | null | undefined)?.contractRead;
  if (!r || !evidencePath || r.path !== evidencePath) return null;
  return r;
}

/** The reader's own words, as one sentence ending in a full stop. */
const sentence = (message: string | undefined, fallback: string) => `${(message ?? fallback).trim().replace(/\.+$/, "")}.`;

/**
 * What the contract card says about the read, beside the file. A read that
 * went well says nothing here: the prescribed-documents list below is what
 * was read, for the agent to check. A wrong document is said by the card
 * already, in place of the list.
 */
export function contractReadNote(r: ContractRead | null): { tone: "warn"; text: string } | null {
  if (!r || r.outcome !== "failed") return null;
  return {
    tone: "warn",
    text: `Contract not read: ${sentence(r.message, "it couldn't be read just now")} The prescribed documents haven't been checked. Read again, or check them with the solicitor who prepared the contract.`,
  };
}
