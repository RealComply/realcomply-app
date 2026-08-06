"use server";

// The legislation chat bubble (mounted globally, see src/app/layout.tsx and
// src/components/legislation/LegislationChat.tsx). Answers are grounded
// strictly in the Property and Stock Agents Act 2002 (NSW) text embedded in
// src/lib/legislation/psa-act-2002.ts — this is deliberately narrower than
// the full checklist, which also touches the Regulation, the Conveyancing
// Act, the Residential Tenancies Act, the AML/CTF Act, and the ACL. If asked
// about any of those, the model is instructed to say so rather than answer
// from general training-data knowledge.
//
// Same diligence-support framing as everywhere else in the app (see
// extraction.ts): this is a lookup/confirmation aid for the licensee, not
// legal advice, and the system prompt says so on every turn.
//
// The Act's text (~90k tokens) is sent as a single large content block with
// cache_control: { type: "ephemeral" } so repeated turns in the same
// conversation — and other agents' conversations within the ~5 minute cache
// window — only pay full input-token price once. Every turn still resends
// the full text block (the Anthropic API has no server-side "session"
// concept), but cache hits are billed at a fraction of the normal input
// rate.

import Anthropic from "@anthropic-ai/sdk";
import { requireAuthContext } from "@/lib/actions/compliance";
import { PSA_ACT_2002_TEXT } from "@/lib/legislation/psa-act-2002";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResult = {
  error: string | null;
  reply?: string;
};

const MAX_TURNS = 20; // keeps a runaway client-side history bounded

const SYSTEM_PROMPT =
  "You are the legislation lookup assistant inside RealComply, a compliance tool for a NSW licensed real estate " +
  "agency. You help the licensee and their agents look up and confirm what the Property and Stock Agents Act " +
  "2002 (NSW) actually says. This is diligence support only, not legal advice — you are a faster way to find " +
  "and read the right section, not a substitute for the licensee's own judgement or a solicitor. Say so " +
  "naturally when it's relevant (for example when the answer is genuinely unclear, contested, or high-stakes), " +
  "but do not repeat a disclaimer in every single reply — that gets ignored and stops being useful.\n\n" +
  "You have the complete current text of the Act below, current as at 4 August 2026. Answer only from this " +
  "text. Quote or closely paraphrase the actual section when you can, and always name the section number you're " +
  "drawing from (e.g. 's49' or 's49(1)(a)') so the person can go read it themselves.\n\n" +
  "Be direct, not roundabout. Lead with the actual answer in your first sentence — either the rule itself and " +
  "its section number, or, if the Act doesn't cover it, a plain 'the Act doesn't cover that' as the very first " +
  "thing you say. Don't walk the reader through a tour of near-miss or loosely-related sections on the way to " +
  "that conclusion — if a section isn't a real, direct answer to what was asked, leave it out rather than " +
  "listing it as 'related.' A short list of tangential sections is worse than no list: it reads as if you found " +
  "the answer when you didn't, and makes the person do the work of ruling each one out themselves. Only mention " +
  "an adjacent section, briefly, when it is genuinely the closest thing to an answer available and you say so " +
  "explicitly (e.g. 'the Act doesn't require X directly, but s52 comes closest because...').\n\n" +
  "You do NOT have the Property and Stock Agents Regulation 2022, the Conveyancing Act, the Residential " +
  "Tenancies Act, the AML/CTF Act, or the Australian Consumer Law loaded — several of which the RealComply " +
  "checklist also relies on. If a question is really about one of those instead (regulation-level detail, " +
  "prescribed forms, tenancy notices, AML/CTF program obligations, misleading-conduct rules), lead with that — " +
  "say plainly and immediately that it's outside the Act you have access to and that they should check the " +
  "relevant instrument or their adviser directly — do not answer it from general knowledge, and do not pad the " +
  "reply with Act sections that don't actually bear on the question first.\n\n" +
  "Keep answers concise and direct — a couple of short paragraphs at most, not an essay. This is a quick " +
  "lookup tool used mid-task, not a legal memo.\n\n" +
  `=== Property and Stock Agents Act 2002 (NSW) — full text ===\n\n${PSA_ACT_2002_TEXT}`;

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
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
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
