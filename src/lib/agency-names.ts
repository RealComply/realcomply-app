// An office's two names (brief, 14 Oct 2026; mockup approved by Adam; 0070).
//
//   * The trading name (agencies.name): the name clients know them by. Shown
//     at the top of RealComply, on every screen and in every email.
//   * The licensed entity name (agencies.licensed_entity_name): the company
//     that holds the corporation licence. Given at sign-up, read from the
//     corporation licence, typed in Office profile, or edited on the annexure
//     signing page.
//
// Formal documents (the compliance audit file cover and the annexure's Agency
// line) say "[licensed entity name] trading as [trading name]". With no
// entity name saved, or one that is the trading name over again, they show
// the trading name alone, as before. Pure: no database.

export const TRADING_NAME_LABEL = "Trading name";
export const TRADING_NAME_HINT = "The name your clients know you by. Shown at the top of RealComply and in your emails.";
export const ENTITY_NAME_LABEL = "Licensed entity name";
export const ENTITY_NAME_HINT = "The company that holds the corporation licence.";
export const ENTITY_NAME_SIGNUP_HINT = "The company on your corporation licence, if different from your trading name.";
export const ENTITY_FROM_LICENCE = "Read from your corporation licence";

export const ENTITY_NAME_MAX = 200;

/**
 * The same company name, compared loosely: case, punctuation, spacing and the
 * spelling of "Pty Ltd" ("Pty. Limited", "Proprietary Limited") don't matter.
 * Anything else does: "Lloyd Pty Ltd" is not "Trent Lloyd Corporation Pty Ltd".
 */
export function sameEntityName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = entityKey(a);
  const y = entityKey(b);
  return x !== "" && x === y;
}

function entityKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === "proprietary" ? "pty" : w === "limited" ? "ltd" : w))
    .join(" ");
}

/** Tidies a typed name: trimmed, single spaces. Empty is null. */
export function tidyName(value: string | null | undefined): string | null {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

export type AgencyNames = { tradingName: string; licensedEntityName: string | null };

/**
 * The Agency line on a formal document. "X trading as Y", or the trading name
 * alone when there is no entity name or it is the same name.
 */
export function formalAgencyName(names: AgencyNames): string {
  const trading = tidyName(names.tradingName) ?? "";
  const entity = tidyName(names.licensedEntityName);
  if (!entity || !trading || sameEntityName(entity, trading)) return trading || entity || "";
  return `${entity} trading as ${trading}`;
}

export type NameChange = {
  name_kind: "trading" | "licensed_entity";
  old_name: string | null;
  new_name: string | null;
  changed_at: string;
};

/**
 * The names as they stood at a moment, from today's names and the history of
 * changes (agency_name_changes, 0070). For each name, the first change after
 * that moment says what it was before; with none, it is today's.
 *
 * Used so a finished audit file keeps the names it was finished under: the
 * file is rebuilt on every download, and a later change of name must not
 * reach back into it.
 */
export function namesAsAt(current: AgencyNames, changes: NameChange[], at: string | null): AgencyNames {
  if (!at) return current;
  const when = Date.parse(at);
  if (Number.isNaN(when)) return current;
  const firstAfter = (kind: NameChange["name_kind"]) =>
    changes
      .filter((c) => c.name_kind === kind && Date.parse(c.changed_at) > when)
      .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at))[0];
  const trading = firstAfter("trading");
  const entity = firstAfter("licensed_entity");
  return {
    tradingName: trading ? (trading.old_name ?? current.tradingName) : current.tradingName,
    licensedEntityName: entity ? entity.old_name : current.licensedEntityName,
  };
}

export type NameChangeVia = "office_profile" | "corporation_licence" | "sign_up" | "signing_page";

/**
 * One line under the licensed entity name in Office profile: how it was last
 * set, by whom and when. `who` is the person's name, or the name typed on the
 * signing page; `when` is already formatted.
 */
export function describeEntityNameChange(via: NameChangeVia, who: string | null, when: string): string {
  const by = who ? ` by ${who}` : "";
  switch (via) {
    case "corporation_licence":
      return `Read from the corporation licence${by}, ${when}.`;
    case "sign_up":
      return `Given at sign-up${by}, ${when}.`;
    case "signing_page":
      return `Changed on the annexure signing page${by}, ${when}.`;
    default:
      return `Changed${by}, ${when}.`;
  }
}

/**
 * Whether a corporation licence just saved asks "Use [holder] as your licensed
 * entity name?": the holder was read, and the office has no licensed entity
 * name or a different one. A match asks nothing.
 */
export function asksAboutEntityName(holderName: string | null | undefined, licensedEntityName: string | null | undefined): boolean {
  return Boolean(tidyName(holderName)) && !sameEntityName(holderName, licensedEntityName);
}
