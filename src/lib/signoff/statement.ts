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
  /**
   * The licensee in charge this file is being put to, from agencies.licensee_name.
   *
   * Naming them in the statement does more than address the page. The signed
   * record then carries both who was ASKED and who actually SIGNED (the typed
   * name), and a later reader can see whether they were the same person. A
   * statement that only records a typed name cannot answer the question an
   * auditor would ask first.
   *
   * Null is stated as unrecorded rather than omitted, like every other fact here.
   */
  licenseeName: string | null;
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
    input.licenseeName
      ? `Licensee in charge: ${input.licenseeName}`
      : `Licensee in charge: not recorded in the file`,
  );
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
  // The sentence that does the liability work, and the one to change most
  // carefully. Two decisions in it:
  //
  // IT STAYS INSIDE THE SIGNED TEXT rather than sitting below the signature as
  // context. An external licensee on the agent tier is not RealComply's
  // customer — the terms of service do not bind them — so a sentence they have
  // personally signed, saying the software certified nothing, is close to the
  // only direct evidence of their understanding that would exist if this file
  // were ever disputed. Moving it below the line would read better and lose
  // exactly the thing worth having. Flagged for Natalie Melia within the DPA
  // work, since it is her call more than ours.
  //
  // IT SAYS WHAT THE SOFTWARE DID, not what category it belongs to. "Diligence
  // support" is the right phrase inside RealComply and opaque to a licensee
  // reading it cold — it does not tell them what was actually done to this
  // file, which is the thing they need in order to judge how much weight to
  // put on it. "Organises the file and flags what is outstanding" is both
  // plainer and more protective, because a licensee who knows precisely what
  // they relied on cannot later say they thought it was more than that.
  lines.push(
    "This sign-off is my own assessment. RealComply organises the file and flags what is " +
      "outstanding; it does not decide whether this file is compliant, does not give legal advice, " +
      "and has formed no view in my place. Responsibility for this decision is mine.",
  );
  lines.push("");
  lines.push(`Ruleset: ${input.rulesetVersion}`);
  lines.push(`Requested: ${formatDate(input.issuedOn) ?? input.issuedOn}`);

  return lines.join("\n");
}
