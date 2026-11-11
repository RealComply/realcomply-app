// What the identity card says when its file went on without the ID check
// (1 Nov 2026). The check fails open: when it can't look at a file (the
// reader was busy, its answer was cut off, the file is a kind it can't read),
// the file is attached anyway rather than blocking the agent. Before, nothing
// said so. Now the card does, beside that file, until another file replaces it.
//
// Not for an old Word file (.doc) (Master, 11 Nov 2026): it is never read, so
// "couldn't be checked just now" isn't true of it. The card says instead that
// it is kept as a Word file, with Upload a PDF (lib/storage/accepted-files.ts).

import { unreadableKind } from "@/lib/storage/accepted-files";

export const ID_SCREEN_SKIPPED =
  "This file couldn't be checked for identity documents just now, so it was attached without the check. " +
  "If it's a copy of a licence, passport, rates notice or the like, replace it with the verification record: " +
  "the VOI certificate or the signing audit trail.";

/** The card's line about its file, or null when the file was checked (or it's another file). */
export function idScreenNote(
  data: unknown,
  evidencePath: string | null | undefined,
): { tone: "warn"; text: string } | null {
  const skipped = (data as { idScreenSkipped?: { path?: unknown } } | null | undefined)?.idScreenSkipped;
  if (!skipped || !evidencePath || skipped.path !== evidencePath) return null;
  if (unreadableKind(evidencePath, { listingCard: true }) === "older Word files (.doc)") return null;
  return { tone: "warn", text: ID_SCREEN_SKIPPED };
}
