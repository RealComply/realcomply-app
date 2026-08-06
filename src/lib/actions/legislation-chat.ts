"use server";

// The legislation chat bubble (mounted globally, see src/app/layout.tsx and
// src/components/legislation/LegislationChat.tsx). Answers are grounded
// strictly in the six pieces of legislation embedded under
// src/lib/legislation/ — the full set the RealComply sales-compliance
// checklist itself cites (see claude/RealComply-rules-schema.md):
//   - Property and Stock Agents Act 2002 (NSW)
//   - Property and Stock Agents Regulation 2022 (NSW)
//   - Conveyancing Act 1919 (NSW)
//   - Conveyancing (Sale of Land) Regulation 2022 (NSW)
//   - Residential Tenancies Act 2010 (NSW)
//   - Australian Consumer Law (Sch 2, Competition and Consumer Act 2010 (Cth))
// The AML/CTF Act (Cth) is deliberately not included — RealComply only
// tracks a CDD attestation for AML, it doesn't perform or interpret AML
// obligations itself, so there's little for a legislation lookup tool to
// usefully answer there. If asked about it, or anything else outside the six
// sources above, the model is instructed to say so rather than answer from
// general training-data knowledge.
//
// Same diligence-support framing as everywhere else in the app (see
// extraction.ts): this is a lookup/confirmation aid for the licensee, not
// legal advice, and the system prompt says so on every turn.
//
// All six texts together run to a genuinely large prompt (low hundreds of
// thousands of tokens) — every turn resends the full set (the Anthropic API
// has no server-side "session" concept), so a single cache_control
// breakpoint is placed on the LAST static block only. That's sufficient: a
// breakpoint caches everything from the start of the request up to and
// including that block, so one breakpoint after all six documents caches the
// whole static prefix as one unit. Repeated turns in the same conversation —
// and other agents' conversations within the cache TTL — hit that cache
// instead of paying full input-token price again.

import Anthropic from "@anthropic-ai/sdk";
import { requireAuthContext } from "@/lib/actions/compliance";
import { PSA_ACT_2002_TEXT } from "@/lib/legislation/psa-act-2002";
import { PSA_REGULATION_2022_TEXT } from "@/lib/legislation/psa-regulation-2022";
import { CONVEYANCING_ACT_1919_TEXT } from "@/lib/legislation/conveyancing-act-1919";
import { CONVEYANCING_SALE_OF_LAND_REGULATION_2022_TEXT } from "@/lib/legislation/conveyancing-sale-of-land-regulation-2022";
import { RESIDENTIAL_TENANCIES_ACT_2010_TEXT } from "@/lib/legislation/residential-tenancies-act-2010";
import { AUSTRALIAN_CONSUMER_LAW_TEXT } from "@/lib/legislation/australian-consumer-law";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResult = {
  error: string | null;
  reply?: string;
};

const MAX_TURNS = 20; // keeps a runaway client-side history bounded

const INSTRUCTIONS =
  "You are the legislation lookup assistant inside RealComply, a compliance tool for a NSW licensed real estate " +
  "agency. You help the licensee and their agents look up and confirm what the underlying legislation actually " +
  "says. This is diligence support only, not legal advice — you are a faster way to find and read the right " +
  "section, not a substitute for the licensee's own judgement or a solicitor. Say so naturally when it's " +
  "relevant (for example when the answer is genuinely unclear, contested, or high-stakes), but do not repeat a " +
  "disclaimer in every single reply — that gets ignored and stops being useful.\n\n" +
  "You have the complete current text of six sources below: the Property and Stock Agents Act 2002 (NSW), the " +
  "Property and Stock Agents Regulation 2022 (NSW), the Conveyancing Act 1919 (NSW), the Conveyancing (Sale of " +
  "Land) Regulation 2022 (NSW), the Residential Tenancies Act 2010 (NSW), and the Australian Consumer Law " +
  "(Schedule 2 to the Competition and Consumer Act 2010 (Cth)). Answer only from this text. Quote or closely " +
  "paraphrase the actual provision when you can, and always name which source and section you're drawing from " +
  "(e.g. 's49 of the Property and Stock Agents Act' or 's18 of the Australian Consumer Law') so the person can " +
  "go read it themselves. If more than one source is relevant, say so and cite each.\n\n" +
  "Be direct, not roundabout. Lead with the actual answer in your first sentence — either the rule itself and " +
  "its citation, or, if none of the six sources cover it, a plain statement that it isn't covered as the very " +
  "first thing you say. Don't walk the reader through a tour of near-miss or loosely-related provisions on the " +
  "way to that conclusion — if a provision isn't a real, direct answer to what was asked, leave it out rather " +
  "than listing it as 'related.' A short list of tangential provisions is worse than no list: it reads as if " +
  "you found the answer when you didn't, and makes the person do the work of ruling each one out themselves. " +
  "Only mention an adjacent provision, briefly, when it is genuinely the closest thing to an answer available " +
  "and you say so explicitly (e.g. 'none of these cover X directly, but s52 of the Act comes closest " +
  "because...').\n\n" +
  "You do NOT have the AML/CTF Act, the Property and Stock Agents Regulation's every last schedule of forms, or " +
  "anything beyond the six sources above loaded. If a question is really about something else (AML/CTF program " +
  "obligations, a different state's law, a specific agency's own policy), lead with that — say plainly and " +
  "immediately that it's outside what you have access to and that they should check the relevant instrument or " +
  "their adviser directly — do not answer it from general knowledge, and do not pad the reply with citations " +
  "that don't actually bear on the question first.\n\n" +
  "Keep answers concise and direct — a couple of short paragraphs at most, not an essay. This is a quick " +
  "lookup tool used mid-task, not a legal memo.";

// Each source as its own block (clearly labelled so the model can cite which
// one it's drawing from) — only the LAST block carries the cache_control
// breakpoint; see the file header comment for why one breakpoint suffices.
function buildSystemBlocks(): Anthropic.Messages.TextBlockParam[] {
  const sources: Array<{ label: string; text: string }> = [
    { label: "Property and Stock Agents Act 2002 (NSW) — full text", text: PSA_ACT_2002_TEXT },
    { label: "Property and Stock Agents Regulation 2022 (NSW) — full text", text: PSA_REGULATION_2022_TEXT },
    { label: "Conveyancing Act 1919 (NSW) — full text", text: CONVEYANCING_ACT_1919_TEXT },
    {
      label: "Conveyancing (Sale of Land) Regulation 2022 (NSW) — full text",
      text: CONVEYANCING_SALE_OF_LAND_REGULATION_2022_TEXT,
    },
    { label: "Residential Tenancies Act 2010 (NSW) — full text", text: RESIDENTIAL_TENANCIES_ACT_2010_TEXT },
    {
      label: "Australian Consumer Law — Schedule 2 to the Competition and Consumer Act 2010 (Cth) — full text",
      text: AUSTRALIAN_CONSUMER_LAW_TEXT,
    },
  ];

  const blocks: Anthropic.Messages.TextBlockParam[] = [{ type: "text", text: INSTRUCTIONS }];
  sources.forEach((source, i) => {
    const isLast = i === sources.length - 1;
    blocks.push({
      type: "text",
      text: `=== ${source.label} ===\n\n${source.text}`,
      ...(isLast ? { cache_control: { type: "ephemeral" as const } } : {}),
    });
  });
  return blocks;
}

export async function askLegislationQuestion(history: ChatMessage[]): Promise<ChatResult> {
  await requireAuthContext(); // signed-in agents/licensees only, same as every other action

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "The legislation assistant isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first." };
  }

  const trimmed = history.slice(-MAX_TURNS).filter((m) => m.content.trim().length > 0);
  if (trimmed.length === 0) {
    return { error: "Ask a question first." };
  }
  if (trimmed[trimmed.length - 1].role !== "user") {
    return { error: "Something went wrong with the conversation — try asking again." };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: buildSystemBlocks(),
      messages: trimmed.map((m) => ({ role: m.role, content: m.content })),
    });

    const textBlock = response.content.find((block): block is Anthropic.Messages.TextBlock => block.type === "text");
    if (!textBlock?.text) {
      return { error: "Didn't get a usable answer back — try rephrasing the question." };
    }

    return { error: null, reply: textBlock.text };
  } catch {
    return { error: "Couldn't reach the legislation assistant just now — try again in a moment." };
  }
}
