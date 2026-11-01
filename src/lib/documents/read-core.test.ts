import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  FileCantBeRead,
  TooLargeToRead,
  failedReadSentence,
  logReadFailure,
  readFailure,
  readFailureWhy,
} from "@/lib/documents/read-core";
import { UnfinishedAnswer } from "@/lib/documents/reader-answer";
import { TOO_LARGE_TO_READ } from "@/lib/documents/reader-parts";

// A failed read, in a word and in plain words (Adam, 1 Nov 2026: "an answer
// that hits its length limit (or can't be parsed) is a failure. Log it as an
// error and show the plain failure message on the card").

const apiError = (status: number) => new Anthropic.APIError(status, { error: { message: "overloaded" } }, "overloaded", new Headers());

describe("why a read failed", () => {
  it("names each kind of failure", () => {
    assert.equal(readFailureWhy(new UnfinishedAnswer("cut_off")), "cut_off");
    assert.equal(readFailureWhy(new UnfinishedAnswer("unparseable")), "unparseable");
    assert.equal(readFailureWhy(new TooLargeToRead()), "too_large");
    assert.equal(readFailureWhy(new FileCantBeRead("file", "couldn't download the file")), "file");
    assert.equal(readFailureWhy(new FileCantBeRead("unsupported", "file type not supported")), "unsupported");
    assert.equal(readFailureWhy(apiError(529)), "service");
    assert.equal(readFailureWhy(apiError(413)), "too_large");
    assert.equal(readFailureWhy(new Error("something else")), "other");
  });
});

describe("what a listing document's card says", () => {
  it("says a cut-off answer couldn't be read to the end, and to read it again", () => {
    assert.equal(
      readFailure(new UnfinishedAnswer("cut_off")),
      "couldn't be read to the end, so nothing was taken from it. Try Read again",
    );
    assert.equal(
      readFailure(new UnfinishedAnswer("unparseable")),
      "couldn't be read properly, so nothing was taken from it. Try Read again",
    );
    assert.equal(
      readFailure(new UnfinishedAnswer("refused")),
      "couldn't be read just now, so nothing was taken from it. Try Read again in a minute",
    );
  });

  it("never puts the service's own error on the card", () => {
    assert.equal(readFailure(apiError(529)), "couldn't be read just now. Try again in a minute");
  });

  it("says a file that won't open in its own words", () => {
    assert.equal(readFailure(new FileCantBeRead("file", "couldn't download the file")), "couldn't download the file");
  });
});

describe("what a card that names its document says", () => {
  it("names the document, says why, then what to do on that card", () => {
    assert.equal(
      failedReadSentence("cut_off", "the certificate", "Type the details in, or upload it again.", "fallback"),
      "The certificate couldn't be read to the end, so nothing was taken from it. Type the details in, or upload it again.",
    );
    assert.equal(
      failedReadSentence("service", "the notice", "Try Read again, or put the figures in yourself.", "fallback"),
      "The notice couldn't be read just now, so nothing was taken from it. Try Read again, or put the figures in yourself.",
    );
  });

  it("keeps the card's own words for a file too large or one that won't open", () => {
    assert.equal(failedReadSentence("too_large", "the report", "next", "fallback"), TOO_LARGE_TO_READ);
    for (const why of ["file", "unsupported", "other"] as const) {
      assert.equal(failedReadSentence(why, "the report", "next", "What the card said before."), "What the card said before.");
    }
  });

  it("uses plain words: no dashes, no codes", () => {
    for (const why of ["cut_off", "unparseable", "refused", "no_answer", "service"] as const) {
      const text = failedReadSentence(why, "the covering letter", "Try Read again.", "fallback");
      assert.ok(!/[—–]/.test(text), text);
      assert.ok(!/_/.test(text), text);
      assert.match(text, /^The covering letter couldn't be read/);
    }
  });
});

describe("the error log", () => {
  it("logs the reader and why, never the file's name", (t) => {
    const logged: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    logReadFailure("comparable_sales", new UnfinishedAnswer("cut_off"));
    logReadFailure("cpd_certificate", apiError(529));
    assert.equal(logged[0][0], "document read failed: comparable_sales (cut_off)");
    assert.equal(logged[1][0], "document read failed: cpd_certificate (service)");
    assert.equal(logged[1][1], 529);
    assert.ok(!JSON.stringify(logged).includes(".pdf"));
  });

  it("takes the reason when it is given rather than thrown", (t) => {
    const logged: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    logReadFailure("licence", undefined, "file");
    assert.equal(logged[0][0], "document read failed: licence (file)");
  });
});
