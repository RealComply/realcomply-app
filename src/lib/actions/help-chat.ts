"use server";

// "I have a question about RealComply" — the help half of the chat bubble.
//
// Adam, 16 Aug 2026: the assistant should answer questions about using the
// product, not only about the legislation, with the two picked from a menu
// when the bubble opens.
//
// WHY A SEPARATE ACTION RATHER THAN A MODE FLAG ON THE LEGISLATION ONE.
// The two have almost nothing in common except the chat window they share.
// Their grounding is different (a product guide against six Acts), their
// failure modes are different (inventing a feature against misreading a
// section), and their cost is wildly different — the legislation prompt runs
// to hundreds of thousands of tokens on every turn, and asking "where do I
// upload the contract?" has no business paying for that. Keeping them apart
// makes a help answer cheap and fast, and stops one prompt growing a second
// personality.
//
// THE FAILURE MODE THIS PROMPT IS BUILT AROUND: a model asked about a product
// it can see documentation for will happily invent the rest. An agent asking
// for help is, by definition, someone who cannot tell a plausible answer from
// a true one. So the instruction to say "I don't know, here's who does" is the
// most important line in this file, and the guide it is grounded in generates
// its item list from the live rules registry rather than a hand-kept copy.

import Anthropic from "@anthropic-ai/sdk";
import { requireAuthContext } from "@/lib/actions/compliance";
import { buildProductGuide } from "@/lib/help/product-guide";
import type { ChatMessage, ChatResult } from "@/lib/actions/legislation-chat";

const MAX_TURNS = 20;

const INSTRUCTIONS = `
You are the help assistant inside RealComply, a compliance system used by NSW
licensed real estate agencies. You answer questions about how to USE RealComply
— where to find something, what a screen does, why an item is or is not
showing, what happens when a button is pressed.

Ground every answer in the product guide below. It describes the product as it
actually is, and the item list in it is generated from the live ruleset.

WHEN YOU DO NOT KNOW, SAY SO. This is the most important rule here. The person
asking cannot tell the difference between an answer you know and one you have
constructed, and a confident wrong answer about where to click wastes their
time and costs their trust in everything else the product tells them. If the
guide does not cover it, say plainly that you are not sure, and suggest they
ask their licensee or contact RealComply support. Never invent a screen, a
button, a menu item or a setting.

STAY IN YOUR LANE. You answer questions about the software. If someone asks
what the law requires — whether cooling-off applies, what s52A demands, whether
something is a material fact — tell them that is what "Ask the Act" is for and
that they can switch to it from the menu at the top of this window. Do not
attempt a legal answer from the product guide. Explaining what an item in
RealComply is for is fine; explaining what the legislation behind it means is
not.

Do not give legal advice, and do not tell anyone their file is compliant. You
can describe what RealComply records and flags. Whether a file is in order is
the licensee's judgement.

Be brief. Two or three sentences usually does it, and name the screen or button
so they can go straight there. Plain English, Australian spelling. No headings
or bullet lists unless a genuine step-by-step needs them.
`.trim();

export async function askProductQuestion(history: ChatMessage[]): Promise<ChatResult> {
  await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "The help assistant isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first." };
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
      max_tokens: 700,
      system: [
        { type: "text" as const, text: INSTRUCTIONS },
        {
          type: "text" as const,
          text: `# RealComply product guide\n\n${buildProductGuide()}`,
          // The guide is identical for every user and every turn, so it caches
          // cleanly. Far smaller than the legislation prompt, but the same
          // reasoning applies and it costs nothing to mark.
          cache_control: { type: "ephemeral" as const },
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
    return { error: "Couldn't reach the help assistant just now — try again in a moment." };
  }
}
