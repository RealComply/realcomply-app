import type Anthropic from "@anthropic-ai/sdk";

// One answer from the document reader (30 Oct 2026).
//
// Every read asks the model to call one tool, and the answer is that call's
// input. An answer can come back unfinished: cut off at the token cap, refused,
// or with no tool call in it at all. Taken as it came, an unfinished answer
// looked exactly like an empty one, and an empty answer is a real result
// ("nothing found"). So a comparable-sales report whose list of sales ran past
// the cap came back as a report with no sales in it, and nothing said so: the
// comparables were never saved, the reasoning draft (which waits for them)
// never appeared, and three live listings went on without either. A reader
// that asks for it now gets the failure instead, and says so.

export type UnfinishedWhy = "cut_off" | "refused" | "no_answer";

export class UnfinishedAnswer extends Error {
  readonly why: UnfinishedWhy;
  constructor(why: UnfinishedWhy) {
    super(`the reader's answer was unfinished (${why})`);
    this.why = why;
  }
}

/**
 * The tool's input from one response, or null where there is none. With
 * failIfUnfinished, an answer that did not finish throws UnfinishedAnswer
 * rather than passing for an answer that found nothing.
 */
export function toolAnswer(
  response: Pick<Anthropic.Messages.Message, "content" | "stop_reason">,
  failIfUnfinished: boolean,
): Record<string, unknown> | null {
  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (failIfUnfinished) {
    if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") {
      throw new UnfinishedAnswer("cut_off");
    }
    if (response.stop_reason === "refusal") throw new UnfinishedAnswer("refused");
    if (!toolUse) throw new UnfinishedAnswer("no_answer");
  }
  return (toolUse?.input ?? null) as Record<string, unknown> | null;
}

/** What an unfinished read says on screen, after the document's name. */
export function unfinishedMessage(why: UnfinishedWhy): string {
  return why === "cut_off"
    ? "couldn't be read to the end, so nothing was taken from it. Try Read again"
    : "couldn't be read just now, so nothing was taken from it. Try Read again in a minute";
}
