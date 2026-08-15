// The licensee sign-off statement.
//
// This is the text a licensee in charge reads and puts their name to, often
// without ever having seen RealComply before. It is snapshotted into
// property_signoff_requests.statement at the moment a link is issued, so a
// later change here can never alter what a past signer appears to have agreed
// to.
//
// WHAT IT TIES TO (Adam, 15 Aug 2026): the property, the date the selling
// agency agreement was signed, and the estimated selling price. Explicitly NOT
// the vendor's name — properties do not store one, and he confirmed the
// sign-off is meaningful without it.
//
// WHAT IT MUST NEVER SAY. Not "RealComply certifies", not "this file is
// compliant", not anything that reads as the software having formed a view the
// licensee is merely countersigning. The licensee is confirming that THEY have
// reviewed the file and are satisfied. That framing is the product's liability
// posture (project brief §4) and it matters most here, on the one page an
// outside party actually reads.

export type StatementInput = {
  agencyName: string;
  propertyAddress: string;
  /** Date the selling agency agreement was signed (item a3), ISO or null. */
  agreementDate: string | null;
  espLow: number | null;
  espHigh: number | null;
  rulesetVersion: string;
  /** Date the link was issued, ISO. Passed in rather than read from the clock so the caller controls it. */
  issuedOn: string;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-AU")}`;
}

/**
 * Builds the statement. Every fact is stated as unavailable rather than
 * guessed: a licensee reading "not recorded" knows to go and look, whereas a
 * quietly omitted line reads as though there was nothing to say.
 */
export function buildSignoffStatement(input: StatementInput): string {
  const agreement = formatDate(input.agreementDate);

  const esp =
    input.espLow != null && input.espHigh != null
      ? input.espLow === input.espHigh
        ? formatMoney(input.espLow)
        : `${formatMoney(input.espLow)} to ${formatMoney(input.espHigh)}`
      : null;

  const lines: string[] = [];

  lines.push(`Property: ${input.propertyAddress}`);
  lines.push(`Agency: ${input.agencyName}`);
  lines.push(
    agreement
      ? `Selling agency agreement signed: ${agreement}`
      : `Selling agency agreement signed: not recorded in the file`,
  );
  lines.push(
    esp
      ? `Estimated selling price: ${esp}`
      : `Estimated selling price: not recorded in the file`,
  );
  lines.push("");
  lines.push(
    "By signing below I confirm that I am the licensee in charge responsible for supervising this " +
      "sale, that I have reviewed the compliance file for the property above, and that I am " +
      "satisfied with it.",
  );
  lines.push("");
  lines.push(
    "This sign-off is my own assessment. RealComply provides diligence support to the agency and " +
      "does not certify compliance, give legal advice, or form any view on this file in my place. " +
      "Responsibility for this decision remains mine.",
  );
  lines.push("");
  lines.push(`Ruleset: ${input.rulesetVersion}`);
  lines.push(`Requested: ${formatDate(input.issuedOn) ?? input.issuedOn}`);

  return lines.join("\n");
}
