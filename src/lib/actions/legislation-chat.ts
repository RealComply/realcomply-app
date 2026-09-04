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
// RETRIEVAL, since 4 Sep 2026. Only the sections that bear on the question
// are sent.
//
// Until then all six texts went up on every turn — about 1.5 million
// characters, cached against a single breakpoint so repeat turns were at
// least cheap. It still meant every question, however narrow, carried the
// whole statute book, and made the model find one line in a phone book.
// Typical question now sends two to nine thousand characters instead.
//
// THE CONSEQUENCE THAT MATTERS, and the reason the instructions below were
// rewritten rather than left alone: with the full text loaded, "the Act does
// not say that" was a conclusion the model could legitimately reach. With
// selected sections it is not. Absence from an excerpt is not absence from
// the Act, and in a compliance tool the difference between "there is no such
// obligation" and "I could not find it" is the difference between a licensee
// who checks and one who does not. See lib/legislation/sections.ts, which
// also flags when nothing matched well enough to answer from at all.

import Anthropic from "@anthropic-ai/sdk";
import { requireAuthContext } from "@/lib/actions/compliance";
import { findSections, isWeak, renderSections } from "@/lib/legislation/sections";

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
  "Six sources are searched: the Property and Stock Agents Act 2002 (NSW), the Property and Stock Agents " +
  "Regulation 2022 (NSW), the Conveyancing Act 1919 (NSW), the Conveyancing (Sale of Land) Regulation 2022 " +
  "(NSW), the Residential Tenancies Act 2010 (NSW), and the Australian Consumer Law (Schedule 2 to the " +
  "Competition and Consumer Act 2010 (Cth)).\n\n" +
  "IMPORTANT — YOU ARE SEEING SELECTED SECTIONS, NOT THE FULL TEXT. Below are the sections that matched this " +
  "question, retrieved from those six sources. They are not everything those sources contain. So you must never " +
  "say that an Act does not contain something, does not require something, or is silent on a point — you " +
  "cannot know that from an excerpt. When you cannot answer from what is in front of you, say that you could " +
  "not find it in the sections that matched, suggest how they might rephrase, and say they should check the " +
  "instrument itself or their adviser. 'There is no such obligation' and 'I could not find it' are completely " +
  "different statements to a licensee deciding what to do, and only the second one is ever available to you.\n\n" +
  "Answer only from the sections below. Quote or closely paraphrase the actual provision, and always name the " +
  "source and section you're drawing from (e.g. 's49 of the Property and Stock Agents Act' or 's18 of the " +
  "Australian Consumer Law') so the person can go read it themselves. If more than one is relevant, cite each.\n\n" +
  "Be direct, not roundabout. Lead with the actual answer in your first sentence — either the rule itself and " +
  "its citation, or, if the sections below don't answer it, a plain statement of that as the very " +
  "first thing you say. Don't walk the reader through a tour of near-miss or loosely-related provisions on the " +
  "way to that conclusion — if a provision isn't a real, direct answer to what was asked, leave it out rather " +
  "than listing it as 'related.' A short list of tangential provisions is worse than no list: it reads as if " +
  "you found the answer when you didn't, and makes the person do the work of ruling each one out themselves. " +
  "Only mention an adjacent provision, briefly, when it is genuinely the closest thing to an answer available " +
  "and you say so explicitly (e.g. 'none of these cover X directly, but s52 of the Act comes closest " +
  "because...').\n\n" +
  "You do NOT have the AML/CTF Act or anything beyond the six sources above. If a question is really about " +
  "something else (AML/CTF program " +
  "obligations, a different state's law, a specific agency's own policy), lead with that — say plainly and " +
  "immediately that it's outside what you have access to and that they should check the relevant instrument or " +
  "their adviser directly — do not answer it from general knowledge, and do not pad the reply with citations " +
  "that don't actually bear on the question first.\n\n" +
  "Keep answers concise and direct — a couple of short paragraphs at most, not an essay. This is a quick " +
  "lookup tool used mid-task, not a legal memo.";

/**
 * What to search on.
 *
 * The last question, plus the one before it. Follow-ups are the norm in this
 * chat — "and what's the penalty?", "does that apply to rural land too?" —
 * and on their own they retrieve nothing useful, because the subject is in
 * the previous turn rather than this one. Two turns is enough to carry the
 * subject forward without letting an unrelated earlier question drag the
 * search off course.
 */
function retrievalQuery(history: ChatMessage[]): string {
  const questions = history.filter((m) => m.role === "user").map((m) => m.content);
  return questions.slice(-2).reverse().join(" ");
}

/**
 * Instructions, then the sections that matched.
 *
 * The cache_control breakpoint sits on the INSTRUCTIONS block now, not after
 * the legislation. That is the whole point of the change: the instructions
 * are the only part that repeats between questions, so they are the only part
 * worth caching. The sections differ every time and never would have.
 */
function buildSystemBlocks(query: string): Anthropic.Messages.TextBlockParam[] {
  const hits = findSections(query);

  const blocks: Anthropic.Messages.TextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" as const } },
  ];

  if (isWeak(hits)) {
    // Deliberately sent with NO sections attached, even though a handful
    // scored something. Handing over weak matches is what produces a
    // confident answer built out of near-misses — the exact failure the
    // instructions above spend a paragraph forbidding. Nothing to quote is a
    // far better prompt for "I could not find it" than four tangential
    // provisions and a request not to use them.
    blocks.push({
      type: "text",
      text:
        "=== Matching sections ===\n\n" +
        "None. The search found nothing in the six sources that answers this question.\n\n" +
        "Say so as the first thing in your reply. Do not answer from general knowledge. Suggest they try " +
        "different words if the topic really is one of the six sources, and otherwise say plainly that it is " +
        "outside what you can check and point them to the instrument itself or their adviser.",
    });
    return blocks;
  }

  blocks.push({
    type: "text",
    text:
      `=== Matching sections (${hits.length}, most relevant first) ===\n\n` +
      renderSections(hits) +
      "\n\n=== End of matching sections ===\n\n" +
      "These are the sections that matched, not the complete Acts. If the answer is not here, say you could " +
      "not find it — never that the legislation does not contain it.",
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
      // Raised from 1024 on 4 Sep 2026. A legislation answer that quotes the
      // section it is citing — which is the entire point of this feature —
      // does not reliably fit in 1024 tokens, and anything the model spends
      // before writing the answer comes out of the same budget. A ceiling
      // that truncates a correct answer is worse here than one that is
      // occasionally generous: nobody is billed by the token for reading
      // their own Act.
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: buildSystemBlocks(retrievalQuery(trimmed)),
      messages: trimmed.map((m) => ({ role: m.role, content: m.content })),
    });

    // Every text block, joined — not just the first one found.
    //
    // The old code took `content.find(type === "text")` and gave up if that
    // one block was missing or empty. A reply is a LIST of blocks and the
    // text can arrive as several of them, or after a block of another kind
    // entirely. Reading only the first meant a perfectly good answer could
    // be discarded, and the user told to "try rephrasing the question" —
    // advice that could not possibly have helped, because rephrasing was
    // never the problem.
    const reply = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n")
      .trim();

    if (!reply) {
      // The one fact needed to diagnose this was being thrown away. If a
      // reply genuinely arrives with no text in it, record WHY — the stop
      // reason says whether it ran out of room, refused, or stopped for some
      // reason we have not seen yet, and the block types say what came back
      // instead. Without this line the next occurrence is another guess.
      console.error(
        "Ask the Act: reply had no text.",
        "stop_reason:", response.stop_reason,
        "blocks:", response.content.map((b) => b.type).join(",") || "(none)",
        "usage:", JSON.stringify(response.usage),
      );
      return {
        error:
          response.stop_reason === "max_tokens"
            ? "That answer was too long to finish. Try asking about one section at a time."
            : "Didn't get an answer back that time. Try again, and tell Adam if it keeps happening.",
      };
    }

    return { error: null, reply };
  } catch (e) {
    // Also silent until now. A blank catch meant an expired key, a rate
    // limit and a prompt the model refused all looked identical from the
    // outside, and none of them left a trace to look at afterwards.
    console.error("Ask the Act failed:", e instanceof Error ? e.message : e);
    return { error: "Couldn't reach the legislation assistant just now — try again in a moment." };
  }
}
