import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { STAGE_LABELS, type PropertyStage } from "@/lib/types";

// What the help assistant knows about RealComply.
//
// TWO HALVES, ON PURPOSE.
//
// The prose below is hand-written and describes how the product behaves — the
// things a new agent asks in their first week, which no amount of reading the
// code would answer well.
//
// The item inventory is GENERATED from the rules registry at request time. It
// is the half most likely to go stale, because the registry changes weekly:
// items get added, reworded, hidden, or dropped (the ESP review log was
// deleted outright; the pool certificate is now single-lot only). A
// hand-maintained list would have been wrong within a fortnight and would have
// been wrong invisibly, which is the worst kind — an agent trusts a help
// answer precisely because they do not already know the answer. Generating it
// means the assistant describes the app that exists rather than the app that
// existed when someone last updated a document.
//
// WHAT IS DELIBERATELY ABSENT: anything about the user's own data. The help
// assistant answers "how does this work", never "what is outstanding on
// Rickard Road". That is a different feature with different privacy and
// accuracy stakes, and mixing them would mean every help answer carried the
// risk of misreporting a real file's compliance state.

const PRODUCT_OVERVIEW = `
## What RealComply is

RealComply is a compliance system for NSW real estate agencies. It keeps a
listing's compliance file up to date as the agent works, flags what needs
attention, and produces a record the agency can show Fair Trading or their
adviser.

It is diligence support. It does not certify compliance, it does not give
legal advice, and the licensee in charge remains responsible for decisions and
sign-off. Answers should reflect that without labouring it.

## How a listing works

Every listing moves through six stages: ${Object.values(STAGE_LABELS).join(", ")}.

Each stage has its own set of items. An item is one obligation or record — a
signed agreement, an ESP, a disclosure. Items are marked done, flagged, or left
open. Some require a date before they can be marked done, because the date is
the thing that proves the obligation was met (the consumer guide, for example,
must be given BEFORE the agreement is signed).

A stage is completed with the "Complete stage" button, which moves the listing
on. Items required for stage completion have to be resolved first. A property
can be put in "practice listing" mode from Edit listing details, which unlocks
every stage for viewing so someone can try things out without pushing a real
file forward.

## Documents and the AI

Three documents are attached when a listing is created: the agency agreement,
the contract for sale, and the comparable-sales report. The AI reads them and
pre-fills what it can find — the ESP figures, the date the agreement was
signed, whether the consumer guide was acknowledged, and which s52A prescribed
documents are present in the contract.

Everything the AI produces is a draft. The agent can edit or discard any of it
before saving, and nothing is committed on the AI's say-so alone. Re-attaching
a document triggers a fresh read.

Evidence can be attached to most items, one file each. A few items have no
attachment on purpose, because their evidence lives on another item — the ESP
reasoning is evidenced by the comparable-sales report, and the commission
disclosure and cooling-off status are both inside the signed agency agreement.

## Sign-off

The final stage has three steps in order: the agent signs, the file is sent to
the licensee, and the licensee signs.

A licensee who uses RealComply signs in the app. A licensee who does not — an
agent-only subscription, where the licensee has never used the product — gets a
link instead. "Create sign-off link" produces a link the agent copies and sends
to their licensee, who opens it, reads a statement naming the property, the
agency agreement date and the ESP, types their name and signs. No account
needed. The file updates the moment they submit. Links last 30 days, work once,
and can be revoked. The licensee's email is set once, at agency setup or on the
Team page.

## Registers

Separate from listings, the agency keeps registers: licences (each person's,
plus the corporation licence the company holds in its own right), insurance
(professional indemnity, cyber, iCare), gifts and benefits, complaints,
breaches and corrective actions, training and CPD, and document sign-offs such
as the Supervision Guidelines manual.

## Emails

A digest goes out Monday morning showing what needs attention across the
agency. Each agent gets their own listings; the licensee also gets an
agency-wide view.

## Roles

Two flags, and one person can hold both: agent, and licensee in charge. Some
things are licensee-only — the final sign-off, agency insurance and licence
details, inviting staff, deleting a property. An agent can see them but not
change them.
`.trim();

/**
 * The live item inventory, grouped by stage. Regenerated on every request from
 * the rules registry, so it cannot describe items that no longer exist.
 */
function buildItemInventory(): string {
  const all = allItemsInRuleset();
  const stages = [...new Set(all.map((i) => i.stage))].sort((a, b) => a - b);

  const sections = stages.map((stage) => {
    const lines = all
      .filter((i) => i.stage === stage)
      .map((i) => {
        const flags: string[] = [];
        if (i.licenseeOnly) flags.push("licensee only");
        if (i.requiresDate) flags.push("needs a date");
        if (i.requiredForStageCompletion) flags.push("required to complete the stage");
        if (i.hideEvidence) flags.push("no file attachment");
        return `- **${i.label}** (${i.key})${i.legalBasis ? ` — ${i.legalBasis}` : ""}\n  ${i.description}${
          flags.length ? `\n  [${flags.join("; ")}]` : ""
        }`;
      })
      .join("\n");

    return `### Stage ${stage} — ${STAGE_LABELS[stage as PropertyStage]}\n${lines}`;
  });

  return sections.join("\n\n");
}

export function buildProductGuide(): string {
  return `${PRODUCT_OVERVIEW}

## Every item in the ruleset

Some of these only appear on certain listings — a pool certificate on a
single-lot property with a pool, tenancy items on a tenanted listing, strata
items on a strata one. If someone cannot see an item you have named, that is
usually why, and the answer is to check Edit listing details.

${buildItemInventory()}`;
}
