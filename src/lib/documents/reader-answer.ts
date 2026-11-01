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
// never appeared, and three live listings went on without either.
//
// REVERSAL (Adam, 1 Nov 2026): "stop a silent reader failure ever happening
// again". Was (30 Oct): only the three listing documents (agency agreement,
// contract, comparable-sales report) failed an unfinished answer; the other
// readers kept what they had, so a cut-off licence, insurance certificate, CPD
// certificate, covering letter, revised ESP notice, inspection report or ID
// screen still read as "nothing found". Now every reader does: an unfinished
// answer is a failed read, logged as an error and said on the card. So is an
// answer that can't be used ("can't be parsed"): one that isn't an object,
// lacks what the tool requires, or gives a list where a list belongs as
// something else.

export type UnfinishedWhy = "cut_off" | "refused" | "no_answer" | "unparseable";

export class UnfinishedAnswer extends Error {
  readonly why: UnfinishedWhy;
  constructor(why: UnfinishedWhy) {
    super(`the reader's answer was unfinished (${why})`);
    this.why = why;
  }
}

type SchemaLike = {
  type?: unknown;
  properties?: Record<string, { type?: unknown } | undefined> | null;
  required?: readonly string[] | null;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Why an answer can't be used, or null when it can. Its outline only: an
 * object, holding what the tool requires, with each field it gives of the
 * kind the tool declares (a list, an object, true or false, text, a number).
 * Inside a list nothing is judged here: one odd sale among twenty-seven is the
 * reader's normal business (each reader drops what it can't use), never a
 * reason to throw away the other twenty-six.
 */
export function answerShapeProblem(answer: unknown, schema: SchemaLike | null | undefined): string | null {
  if (!isPlainObject(answer)) return "the answer isn't an object";
  if (!schema) return null;
  for (const key of schema.required ?? []) {
    if (answer[key] === undefined || answer[key] === null) return `the answer has no ${key}`;
  }
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    const value = answer[key];
    if (value === undefined || value === null || !field) continue;
    const kind = field.type;
    if (kind === "array" && !Array.isArray(value)) return `${key} isn't a list`;
    if (kind === "object" && !isPlainObject(value)) return `${key} isn't an object`;
    if (kind === "boolean" && typeof value !== "boolean") return `${key} isn't true or false`;
    if (kind === "string" && typeof value !== "string") return `${key} isn't text`;
    if ((kind === "number" || kind === "integer") && (typeof value !== "number" || !Number.isFinite(value))) {
      return `${key} isn't a number`;
    }
  }
  return null;
}

/**
 * The tool's input from one response. An answer that did not finish throws
 * UnfinishedAnswer rather than passing for an answer that found nothing; so
 * does one that can't be used, checked against the tool's own input schema
 * when it is given.
 */
export function toolAnswer(
  response: Pick<Anthropic.Messages.Message, "content" | "stop_reason">,
  schema?: SchemaLike | null,
): Record<string, unknown> {
  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") {
    throw new UnfinishedAnswer("cut_off");
  }
  if (response.stop_reason === "refusal") throw new UnfinishedAnswer("refused");
  if (!toolUse) throw new UnfinishedAnswer("no_answer");
  if (answerShapeProblem(toolUse.input, schema)) throw new UnfinishedAnswer("unparseable");
  return toolUse.input as Record<string, unknown>;
}

/**
 * What an unfinished read says on screen, after the document's name. What to
 * do next is the card's to add: not every card has a Read again button.
 */
export function unfinishedMessage(why: UnfinishedWhy): string {
  if (why === "cut_off") return "couldn't be read to the end, so nothing was taken from it";
  if (why === "unparseable") return "couldn't be read properly, so nothing was taken from it";
  return "couldn't be read just now, so nothing was taken from it";
}
