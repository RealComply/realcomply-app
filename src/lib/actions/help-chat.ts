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
import { sendEmail } from "@/lib/email/send";
import type { ChatMessage, ChatResult } from "@/lib/actions/legislation-chat";

const MAX_TURNS = 20;

// Escalation as a tool call rather than a phrase the model is asked to emit.
//
// Adam, 16 Aug 2026: an unanswerable question should not dead-end at "I don't
// know" — it should tell the person a human will come back to them, and email
// him so the gap gets looked at. Every escalation is a signal about the
// product, not just an unanswered question.
//
// A tool rather than a sentinel string in the reply, because a string is
// something the model can approximate, reword, or emit while also attempting
// an answer. A tool call is unambiguous: either it fired or it did not, and
// the wording the agent sees is then ours rather than the model's, which
// matters when the sentence is a promise that someone will follow up.
const ESCALATION_TOOL: Anthropic.Tool = {
  name: "escalate_question",
  description:
    "Call this when you cannot confidently answer from the product guide. Do not answer and escalate — do one or the other. The person is told a team member will come back to them, and the question is emailed to the RealComply team.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "What the person is actually asking, in one sentence, in your own words.",
      },
      gap: {
        type: "string",
        description:
          "Why you could not answer — what the guide is missing, ambiguous about, or silent on. This is the useful half: it is read as a list of things to fix, so be specific about the gap rather than restating the question.",
      },
    },
    required: ["question", "gap"],
  },
};

// Fixed wording, not the model's. Adam's line, near enough verbatim.
const ESCALATION_REPLY =
  "I'm sorry, I don't have the answer for that right now. I've escalated it, and a member of our team will come back to you shortly.";

// Used only when the escalation email could not be sent. Saying someone will
// follow up when nothing was actually sent would be a straightforward lie, and
// the person would be left waiting on a reply that is never coming.
const ESCALATION_REPLY_SEND_FAILED =
  "I'm sorry, I don't have the answer for that right now, and I wasn't able to pass it on automatically. Please contact your licensee or RealComply support directly so it doesn't get lost.";

const INSTRUCTIONS = `
You are the help assistant inside RealComply, a compliance system used by NSW
licensed real estate agencies. You answer questions about how to USE RealComply
— where to find something, what a screen does, why an item is or is not
showing, what happens when a button is pressed.

Ground every answer in the product guide below. It describes the product as it
actually is, and the item list in it is generated from the live ruleset.

WHEN YOU DO NOT KNOW, ESCALATE. This is the most important rule here. The
person asking cannot tell the difference between an answer you know and one you
have constructed, and a confident wrong answer about where to click wastes
their time and costs their trust in everything else the product tells them.
Never invent a screen, a button, a menu item or a setting.

If the guide does not clearly answer the question, call the escalate_question
tool instead of answering. Do not answer and escalate; do one or the other.
Escalating is a good outcome, not a failure — every escalation tells the team
about a genuine gap, either in the product or in how it explains itself.

Escalate when: the guide does not cover it, it covers it only partly, the
answer would depend on something you cannot see, or the person is reporting
that something is not working. Do not escalate a question you can answer from
the guide just because you are not completely certain of the wording — read it
again first.

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
  const { profile } = await requireAuthContext();

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
      tools: [ESCALATION_TOOL],
    });

    // Escalation wins over any text the model also produced. It is told to do
    // one or the other, and if it does both, the half that promises a human
    // follow-up is the half that must not be dropped.
    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUse) {
      const input = toolUse.input as { question?: string; gap?: string };
      const sent = await sendEscalation({
        question: input.question ?? "",
        gap: input.gap ?? "",
        askedBy: profile.full_name || profile.email,
        askedByEmail: profile.email,
        // The person's own words, which are often more useful than the
        // model's paraphrase — the phrasing someone reaches for is itself
        // evidence of how they think the product works.
        verbatim: trimmed[trimmed.length - 1].content,
      });

      return { error: null, reply: sent ? ESCALATION_REPLY : ESCALATION_REPLY_SEND_FAILED };
    }

    const textBlock = response.content.find((block): block is Anthropic.Messages.TextBlock => block.type === "text");
    if (!textBlock?.text) {
      return { error: "Didn't get a usable answer back — try rephrasing the question." };
    }

    return { error: null, reply: textBlock.text };
  } catch {
    return { error: "Couldn't reach the help assistant just now — try again in a moment." };
  }
}

/**
 * Emails an escalation to whoever runs RealComply.
 *
 * Goes to ADMIN_NOTIFICATION_EMAIL — the same address the new-signup
 * notification uses, already set in Vercel and already verified in SES, so
 * this works today despite the sandbox. It is the one email in the app whose
 * recipient is us rather than a customer, which is exactly why it is not
 * blocked on the Resend migration like everything else.
 *
 * Plain text, and structured so the gap line reads as a to-do. The subject
 * carries the question so a run of them can be skimmed in an inbox without
 * opening any.
 */
async function sendEscalation(input: {
  question: string;
  gap: string;
  askedBy: string;
  askedByEmail: string;
  verbatim: string;
}): Promise<boolean> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("Help escalation not sent: ADMIN_NOTIFICATION_EMAIL is not set.", input);
    return false;
  }

  const shortQuestion = input.question.length > 80 ? `${input.question.slice(0, 77)}…` : input.question;

  return sendEmail({
    to,
    subject: `RealComply help escalation — ${shortQuestion || "unanswered question"}`,
    text: [
      "The help assistant couldn't answer a question and escalated it.",
      "",
      `From: ${input.askedBy} (${input.askedByEmail})`,
      `When: ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} (Sydney)`,
      "",
      "THEY ASKED",
      input.verbatim,
      "",
      "THE ASSISTANT'S READ OF IT",
      input.question,
      "",
      "WHY IT COULDN'T ANSWER",
      input.gap,
      "",
      "They've been told a team member will come back to them shortly.",
    ].join("\n"),
  });
}
