"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { PropertyItem } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

// The three setup-time documents (property creation form) and which item
// each is attached to as evidence — see src/lib/actions/properties.ts.
const SOURCE_ITEM_KEYS = ["a3", "b1", "a4b"] as const;

const SOURCE_LABELS: Record<string, string> = {
  a3: "agency agreement",
  b1: "contract for sale",
  a4b: "comparable-sales report",
};

// Only these items can ever be patched by extraction — a hard allow-list,
// independent of whatever the model returns. Deliberately excludes every
// licenseeOnly item (amc, f1, sign_licensee) and every log-style item
// (d1/d2/d3, offers, reviews) — those have their own entry semantics and
// AI must never touch a licensee sign-off, full stop. Also excludes a1
// (vendor identity/ownership): that's verified externally as part of AML/CTF
// CDD and registered with AUSTRAC there, not something to extract from an
// uploaded document — see the hideNote/hideEvidence attestation item in
// nsw-sales.ts.
const TARGET_ITEM_KEYS = new Set(["a3", "a4", "a4b", "a4c", "a5", "a6", "a7", "b1"]);

type DraftPatch = {
  itemKey: string;
  note?: string;
  espLow?: number;
  espHigh?: number;
  eventDate?: string;
};

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_findings",
  description:
    "Flag anything the agent needs to see for each compliance item — a gap, an ambiguity, something missing, something needing their confirmation. Do not restate facts the document already states plainly; the agent has the document, so repeating it back adds nothing. Only call this with things actually grounded in the document — never a guess or an inference.",
  input_schema: {
    type: "object",
    properties: {
      patches: {
        type: "array",
        description: "Zero or more findings. Return an empty array if there's nothing to flag and no structured figures/dates to record.",
        items: {
          type: "object",
          properties: {
            itemKey: {
              type: "string",
              enum: Array.from(TARGET_ITEM_KEYS),
              description: "Which compliance item this fact supports.",
            },
            note: {
              type: "string",
              description:
                "Only something the agent needs to act on or confirm — a gap, an inconsistency, a missing detail. Never a restatement of a fact the document already states clearly (e.g. do not write 'commission is 2.2%, as stated in clause 4' — that tells the agent nothing they don't already have in front of them). Leave this out entirely, or send an empty string, when the document covers the item completely with nothing exceptional to flag. Exception: for a4c specifically, this field instead carries a short paraphrase of the agent's own ESP reasoning if the document contains it, as an editable starting draft — not a gap-flag.",
            },
            espLow: {
              type: "number",
              description: "Item a4 only — low end of an estimated selling price, only if the document explicitly states a figure.",
            },
            espHigh: {
              type: "number",
              description: "Item a4 only — high end, only if explicitly stated.",
            },
            eventDate: {
              type: "string",
              description: "Only for a date the document explicitly states (e.g. the agreement's signing date). Format YYYY-MM-DD.",
            },
          },
          required: ["itemKey"],
        },
      },
    },
    required: ["patches"],
  },
};

// f3 — pre-purchase inspection report register (cl 37, Property and Stock
// Agents Regulation 2022). Separate tool/schema from record_findings above:
// the fields a report register needs (preparer contact, PI-insured,
// available-for-repurchase) don't fit the property_items aiDraft shape, and
// this never writes to the DB itself — it just returns what it found so the
// agent can review it in the "log a report" form before saving, same
// diligence-support framing as everywhere else.
const REPORT_EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_report_details",
  description:
    "Record pre-purchase inspection report details explicitly and literally stated in the document. Omit any " +
    "field not stated — never guess, infer, or assume a false/negative value for something the document simply " +
    "doesn't mention.",
  input_schema: {
    type: "object",
    properties: {
      pestInspection: {
        type: "boolean",
        description: "True only if this document is or includes a pest/termite inspection report.",
      },
      buildingInspection: {
        type: "boolean",
        description: "True only if this document is or includes a building inspection report.",
      },
      strata: {
        type: "boolean",
        description:
          "True only if this document is a strata report — a strata scheme document inspection or a strata financial certificate.",
      },
      inspectionDate: {
        type: "string",
        description: "The date the property was inspected for this report, only if explicitly stated. Format YYYY-MM-DD.",
      },
      preparerName: {
        type: "string",
        description: "The name of the person or business that prepared/issued the report, only if stated.",
      },
      preparerContact: {
        type: "string",
        description: "The preparer's business address and/or phone number, only if stated.",
      },
      preparerInsured: {
        type: "boolean",
        description:
          "True only if the document explicitly states the preparer holds professional indemnity insurance. " +
          "Omit this field entirely if insurance isn't mentioned at all — never assume false just because it " +
          "isn't stated.",
      },
      availableForRepurchase: {
        type: "boolean",
        description:
          "True only if the document explicitly states the report is available for purchase or reissue to " +
          "another party. Omit if not mentioned.",
      },
    },
    required: [],
  },
};

export type ReportExtractionFields = {
  pestInspection?: boolean;
  buildingInspection?: boolean;
  strata?: boolean;
  inspectionDate?: string;
  preparerName?: string;
  preparerContact?: string;
  preparerInsured?: boolean;
  availableForRepurchase?: boolean;
};

// Downloads an already-uploaded report document (the agent uploads it
// client-side first, same direct-to-Storage pattern as every other evidence
// upload in this app — see src/lib/storage/evidence.ts) and reads off
// whatever cl 37 fields are explicitly stated, for the agent to review and
// complete before logging the register entry. Never writes to the DB.
export async function extractReportDetails(
  path: string,
  fileName: string,
): Promise<{ error: string | null; fields?: ReportExtractionFields }> {
  const { supabase } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "AI extraction isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first." };
  }

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    return { error: "Couldn't download the uploaded file." };
  }

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = blob.type || "application/octet-stream";

  const MIN_TEXT_CHARS = 400;
  if (contentType === "text/plain") {
    const text = Buffer.from(base64, "base64").toString("utf-8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      return { error: null, fields: {} };
    }
  }

  const documentBlock = buildDocumentBlock(contentType, base64, fileName);
  if (!documentBlock) {
    return { error: `File type not supported for extraction yet (${contentType}).` };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system:
      "You are reading a pre-purchase inspection report (pest, building, or strata) for a NSW licensed agent's " +
      "compliance file (RealComply), to help them fill in their cl 37 report register. This is diligence support " +
      "only — the agent reviews and confirms everything before it's saved, you do not. Only record a field if " +
      "the document explicitly and literally states it. Never infer, estimate, or assume a value — especially " +
      "for preparerInsured, where 'not mentioned' must be left out entirely, never recorded as false. You have " +
      "been shown the complete content available to you — do not assume further pages exist. If the document " +
      "doesn't look like a genuine pest, building, or strata report at all, call the tool with an empty object " +
      "rather than guessing at any field. You must call record_report_details exactly once, but calling it with " +
      "few or no fields set is a completely normal, successful, and common outcome — do not stretch to fill in " +
      "a field you're not actually seeing stated.",
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text: `This document was uploaded as "${fileName}" for the pre-purchase inspection report register. Call record_report_details with whatever it explicitly states.`,
          },
        ],
      },
    ],
    tools: [REPORT_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_report_details" },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return { error: null, fields: {} };

  return { error: null, fields: toolUse.input as ReportExtractionFields };
}

function buildDocumentBlock(
  contentType: string,
  base64: string,
  fileName: string,
): Anthropic.Messages.ContentBlockParam | null {
  if (contentType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
    };
  }
  if (contentType === "text/plain") {
    return {
      type: "text",
      text: `Document "${fileName}":\n\n${Buffer.from(base64, "base64").toString("utf-8")}`,
    };
  }
  return null;
}

async function extractOneDocument(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  anthropic: Anthropic,
  item: PropertyItem,
): Promise<DraftPatch[]> {
  const path = item.evidence_path;
  if (!path) return [];

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    throw new Error("couldn't download the file");
  }

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = blob.type || "application/octet-stream";
  const fileName =
    (item.data as { evidenceFileName?: string } | null)?.evidenceFileName ?? path.split("/").pop() ?? "document";

  // Deterministic backstop, not a prompt instruction: a real contract, agency
  // agreement, or comps report is never this short. Skip the model call
  // entirely rather than trust an LLM not to fabricate an answer about
  // content that plainly isn't a real source document — this caught a
  // confirmed hallucination (invented document names) that survived two
  // rounds of prompt-only fixes on a one-line placeholder test file.
  const MIN_TEXT_CHARS = 400;
  if (contentType === "text/plain") {
    const text = Buffer.from(base64, "base64").toString("utf-8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      return [];
    }
  }

  const documentBlock = buildDocumentBlock(contentType, base64, fileName);
  if (!documentBlock) {
    throw new Error(`file type not supported for extraction yet (${contentType})`);
  }

  const sourceLabel = SOURCE_LABELS[item.item_key] ?? item.item_key;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1536,
    system:
      "You are extracting facts from a real-estate compliance document for a NSW licensed agent's compliance " +
      "file (RealComply). This is diligence support only — the licensee reviews everything and decides, you do " +
      "not. Only extract facts the document explicitly and literally states. Never infer, estimate, guess, or " +
      "fill a gap with a plausible-sounding figure, date, or description — including describing what a document " +
      "is missing, lacks, or does not include. A statement about absence is exactly as fabricated as a wrong " +
      "figure if you cannot see the rest of the actual file to know it's true. You have been shown the complete " +
      "content available to you above — do not assume there are further pages, schedules, or attachments beyond " +
      "what is shown, and do not reason from what this type of document 'usually' or 'typically' contains. If " +
      "nothing relevant is written down for an item, or the content shown is too short, generic, or unrelated to " +
      "make a grounded finding, omit that item entirely — an empty patches array is correct and expected, not a " +
      "failure. Keep notes short, factual, and traceable to specific text you were actually shown. One exception " +
      "to 'never speculate': when a document contains its own index or checklist of what's attached (for " +
      "example a contract's 'List of Documents' page), you should cross-check that index against what actually " +
      "appears later in the same document — that is a literal comparison between two parts of the one file in " +
      "front of you, not a guess about the outside world, and it is exactly the kind of grounded finding this " +
      "tool exists for. If a box is ticked but you can't find the matching attachment, or a box is left blank " +
      "despite the item plainly being attached further on, report that mismatch specifically and factually — " +
      "name the document, quote identifying details (issuer, date, certificate or reference number) if visible, " +
      "and say exactly what you found and where it disagrees with the index. Still never assert a document is " +
      "missing or doesn't exist unless you've actually looked through the whole document for it; phrase that as " +
      "'not found in what I was shown', not a categorical claim. Beyond that index-cross-check exception, treat " +
      "the note field as a place to flag something for the agent's attention — a gap, an ambiguity, a missing " +
      "detail, something needing their confirmation or follow-up — never as a summary or restatement of a fact " +
      "the document already states plainly. The agent has the source document open in front of them; telling " +
      "them again what it already says adds nothing. If an item is covered completely with nothing exceptional " +
      "about it, leave the note out of that item's patch (or send an empty string) — 'nothing to flag' is the " +
      "normal, expected, successful outcome, not a sign you should have found something to say. This doesn't " +
      "apply to structured fields (espLow, espHigh, eventDate): keep populating those whenever explicitly " +
      "stated, note or no note — a figure or date saves the agent real typing, unlike a restated sentence. You " +
      "must call record_findings exactly once, but calling it with an empty patches array is a completely " +
      "normal, successful, and common outcome — do not stretch to fill the array with a weak or unsupported " +
      "finding just because you're calling the tool.",
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text:
              `This document was uploaded as the ${sourceLabel}. Call record_findings with any facts it ` +
              "explicitly and literally states that are relevant to these compliance items: a3 (the date the " +
              "agency agreement was signed), a4 (an ESP range, only if a " +
              "figure is explicitly stated in this document), a4b (what comparable-sales evidence is present), " +
              "a4c (the agent's own reasoning behind the ESP — this one item is an exception to the " +
              "note-flagging rule: if the document contains that reasoning text, paraphrase it as a short " +
              "editable starting draft for the agent to refine, not just a gap-flag), a5 " +
              "(commission/rebate/VPA terms), a6 " +
              "(cooling-off), a7 (material facts disclosed), b1 (the s52A prescribed documents — planning " +
              "certificate, sewer/sewerage diagrams, title/plan. First check this actually looks like a real " +
              "contract for sale of land — vendor/purchaser details, price, settlement terms, that kind of " +
              "substance. If it doesn't, say so in one line and stop there; don't attempt the s52A check at all " +
              "on something that isn't genuinely a contract, even though it was labelled as one when uploaded. " +
              "If it does look like a real contract and has a 'List of Documents' index page, don't just read " +
              "the checkboxes and stop — check whether the annexures later in the document actually back up " +
              "what's marked, and name the specific documents you can actually find attached, with identifying " +
              "details like issuer, date, or certificate number where visible. Report any mismatch between the " +
              "index and the actual attachments specifically — that's a comparison within this one document, not " +
              "a guess. Don't claim something is missing unless you've looked through the whole document and " +
              "still can't find it). For every item: only report what is directly readable in the content above; " +
              "if you're not looking at something substantial enough to ground a finding, leave that item out " +
              "rather than filling it in.",
          },
        ],
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_findings" },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return [];

  const input = toolUse.input as { patches?: DraftPatch[] };
  return (input.patches ?? []).filter((p) => TARGET_ITEM_KEYS.has(p.itemKey));
}

// Reads whichever setup documents were attached (agency agreement, contract
// for sale, comparable-sales report) and writes what it finds into each
// target item's data.aiDraft — never into note/status/event_date directly.
// The item stays "open" and untouched either way; ItemCard reads aiDraft as
// a pre-fill default that the agent can edit or discard before saving, per
// the product's diligence-support framing (never auto-completes anything).
export async function extractFromDocuments(propertyId: string): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      error: "AI extraction isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first.",
    };
  }

  const { data: rows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .in("item_key", SOURCE_ITEM_KEYS);

  const withEvidence = ((rows ?? []) as PropertyItem[]).filter((i) => i.evidence_path);

  if (withEvidence.length === 0) {
    return {
      error: "No documents attached yet — attach the agency agreement, contract, or comparable-sales report first.",
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const patches: DraftPatch[] = [];
  const failures: string[] = [];

  for (const item of withEvidence) {
    try {
      patches.push(...(await extractOneDocument(supabase, anthropic, item)));
    } catch (err) {
      failures.push(`${SOURCE_LABELS[item.item_key] ?? item.item_key}: ${err instanceof Error ? err.message : "extraction failed"}`);
    }
  }

  for (const patch of patches) {
    const { data: existingRow } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId)
      .eq("item_key", patch.itemKey)
      .maybeSingle();
    const existing = existingRow as PropertyItem | null;

    await supabase.from("property_items").upsert(
      {
        agency_id: profile.agency_id,
        property_id: propertyId,
        item_key: patch.itemKey,
        status: existing?.status ?? "open",
        data: {
          ...(existing?.data ?? {}),
          aiDraft: {
            note: patch.note,
            espLow: patch.espLow,
            espHigh: patch.espHigh,
            eventDate: patch.eventDate,
            generatedAt: new Date().toISOString(),
          },
        },
        event_date: existing?.event_date ?? null,
        completed_by: existing?.completed_by ?? null,
        evidence_path: existing?.evidence_path ?? null,
      },
      { onConflict: "property_id,item_key" },
    );
  }

  revalidatePath(`/dashboard/${propertyId}`);

  if (patches.length === 0) {
    return {
      error:
        failures.length > 0
          ? `Couldn't extract anything: ${failures.join("; ")}`
          : "Didn't find any clearly-stated facts in the attached documents to pre-fill.",
    };
  }

  return failures.length > 0 ? { error: `Extracted what it could, but hit an issue: ${failures.join("; ")}` } : ok;
}
