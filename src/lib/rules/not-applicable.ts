// "Not applicable" on a card (the property reports disclosure card, f4; Adam,
// 17 Oct 2026), and the same thing asked as a question (the contract served
// card, e1, "Who exchanged contracts?"; Adam, 20 Oct 2026).
//
// The engine only. Which cards offer it, and what the option and its small
// line say, is in the rules file (lib/rules/nsw-sales.ts, the item's
// `notApplicable`). Pure, so what marking and clearing keep, and what the
// compliance file prints, are tested without a database.
//
// WHAT IS KEPT, on the card's data:
//   * whether the card is marked not applicable, and who marked it and when;
//   * a history of every mark and every change back, so a card marked not
//     applicable and later answered another way still shows that it once was.
// Names are kept as they were at the time, like a typed signature, so a later
// change of name never reaches back into the record.
//
// Nothing else on the card is touched. A buyer list or a "recorded somewhere
// else" pointer saved before the mark is still there when it is cleared.

export type NaActor = { id: string; name: string };

export type NaEvent = {
  at: string;
  by: string;
  byName: string;
  event: "marked_na" | "cleared_na";
};

export type NaData = {
  notApplicable?: boolean;
  naBy?: string;
  naByName?: string;
  naAt?: string;
  naHistory?: NaEvent[];
};

/** What the rules file says about a card's "Not applicable" option. */
export type NotApplicableSpec = {
  /** The option itself: "Not applicable". */
  label: string;
  /** The small line under it, printed on the compliance file too. */
  line: string;
  /**
   * Refused while another card has entries logged, with the reason. f4: a
   * report logged on f3 means reports exist, so "none exist" cannot be said.
   */
  refusedWhileLogged?: { itemKey: string; message: string };
  /**
   * Asked as a question rather than offered as a tick box (e1). The card opens
   * with `ask` and two answers: `ours`, which opens the card as it always was,
   * and `label`, which completes it. `hint` sits under them until one is picked.
   */
  question?: { ask: string; ours: string; hint: string };
  /**
   * What the card and the compliance file say once it is chosen, in place of
   * "label: line", and how the line after a change back describes it.
   */
  record?: { text: string; earlier: string };
};

/** Reads stored data defensively; anything unexpected is "not marked". */
export function readNa(raw: unknown): NaData {
  if (!raw || typeof raw !== "object") return { notApplicable: false, naHistory: [] };
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    notApplicable: d.notApplicable === true,
    naBy: str(d.naBy),
    naByName: str(d.naByName),
    naAt: str(d.naAt),
    naHistory: Array.isArray(d.naHistory) ? (d.naHistory as NaEvent[]) : [],
  };
}

/** Marks or clears. The same answer again changes nothing, history included. */
export function applyNa(data: NaData, on: boolean, actor: NaActor, at: string): NaData {
  if ((data.notApplicable === true) === on) return data;
  const naHistory = [
    ...(data.naHistory ?? []),
    { at, by: actor.id, byName: actor.name, event: on ? "marked_na" : "cleared_na" } as NaEvent,
  ];
  if (!on) return { notApplicable: false, naHistory };
  return { notApplicable: true, naBy: actor.id, naByName: actor.name, naAt: at, naHistory };
}

const NA_FIELDS = ["notApplicable", "naBy", "naByName", "naAt", "naHistory"] as const;

/** The card's stored data with the N/A part replaced, everything else kept. */
export function withNa(raw: unknown, na: NaData): Record<string, unknown> {
  const out: Record<string, unknown> = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  for (const k of NA_FIELDS) delete out[k];
  for (const [k, v] of Object.entries(na)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * What a save that rebuilds the card's data (Mark done, Reopen) must carry
 * over: the history, always. If the card was still marked not applicable, the
 * save is a change of answer, so the history gets a "cleared" line for it and
 * the mark itself is not carried. The card's own control never offers Mark
 * done while it is marked; this is the record staying whole regardless.
 */
export function naCarriedThroughSave(existing: unknown, actor: NaActor, at: string): Pick<NaData, "naHistory"> {
  const na = readNa(existing);
  const next = na.notApplicable ? applyNa(na, false, actor, at) : na;
  return next.naHistory && next.naHistory.length > 0 ? { naHistory: next.naHistory } : {};
}

/** True when another card's entries rule the option out (see refusedWhileLogged). */
export function naRefusal(
  spec: NotApplicableSpec,
  other: { data?: unknown } | undefined,
): string | null {
  if (!spec.refusedWhileLogged) return null;
  const entries = (other?.data as { entries?: unknown[] } | undefined)?.entries;
  return Array.isArray(entries) && entries.length > 0 ? spec.refusedWhileLogged.message : null;
}

/**
 * What the compliance file prints under a card that offers "Not applicable".
 * Marked: the option, its line, who and when (or, where the rules file gives
 * a `record`, its words). Marked once and since changed: one line saying so,
 * so the record shows the earlier answer. Never marked: nothing. `when`
 * formats a timestamp.
 */
export function naRecordLines(
  item: { notApplicable?: NotApplicableSpec },
  current: { data?: unknown } | undefined,
  when: (iso: string) => string,
): string[] {
  if (!item.notApplicable) return [];
  const spec = item.notApplicable;
  const na = readNa(current?.data);
  if (na.notApplicable) {
    const byWhen = `by ${na.naByName ?? "a team member"}${na.naAt ? ` on ${when(na.naAt)}` : ""}.`;
    return [spec.record ? `${spec.record.text} Recorded ${byWhen}` : `${spec.label}: ${spec.line} Marked ${byWhen}`];
  }
  const history = na.naHistory ?? [];
  const lastMark = [...history].reverse().find((e) => e.event === "marked_na");
  const lastClear = [...history].reverse().find((e) => e.event === "cleared_na");
  if (!lastMark || !lastClear) return [];
  return [
    `Earlier ${spec.record?.earlier ?? `marked ${spec.label.toLowerCase()}`} by ${lastMark.byName} on ${when(
      lastMark.at,
    )}; changed by ${lastClear.byName} on ${when(lastClear.at)}.`,
  ];
}
