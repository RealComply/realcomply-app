import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildWelcomeEmail, type AnnexureBox } from "./early-access-invite";
import { buildAnnexureRequestEmail, buildAnnexureSignedEmail } from "./sg-annexure";

// The annexure box in the welcome email, and the two annexure emails (brief,
// 14 Oct 2026).

const base = "https://www.realcomply.com.au";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Taken from the welcome email as it was on main before the annexure, for
// "Sam" on the live site. If the welcome is changed on purpose, these change
// with it; until then they prove the box added nothing else.
// 29 Oct 2026: the subject, which the html carries as its title, became
// "Getting started with RealComply, Sam" (Adam). With the old subject put
// back the html is still the original, checked below.
const BEFORE = {
  html: "df04e98f24e8aa45c9e5b6a3f54f6295bf714605ea22e2e5a62911dfe7423f22",
  text: "eb00010b489e1524a06a31cc3e9d1b4ca44e8c0088bfc7fa9860c7e30f7f8aae",
  video: "b58ec67cfd9217914649b6d5f281aa3623bc5b7617b6d44bcf4d37b445406337",
};

function videoBlock(html: string): string {
  const start = html.indexOf('<tr><td style="padding:4px 28px 22px">');
  const end = html.indexOf("</a></td></tr>", start) + "</a></td></tr>".length;
  return html.slice(start, end);
}

const sign: AnnexureBox = {
  kind: "sign",
  agencyName: "Harbour Realty",
  licenceNumber: "10012345",
  date: "14 October 2026",
  url: `${base}/annexure/1b4e28ba-2fa1-11d2-883f-0016d3cca427`,
};

describe("the welcome email's annexure box", () => {
  it("without a box, the welcome is exactly as it was", () => {
    const { html, text } = buildWelcomeEmail({ firstName: "Sam", base });
    assert.equal(sha(html), BEFORE.html);
    assert.equal(sha(text), BEFORE.text);
  });

  it("the 29 Oct subject change touched only the subject", () => {
    const { html } = buildWelcomeEmail({ firstName: "Sam", base });
    const back = html.replaceAll("Getting started with RealComply, Sam", "Welcome to RealComply, Sam");
    assert.equal(sha(back), "103c12a0db6b3de42e79dcedc5c3ff1c05e2454113c79bb67b540b3f2d680f2c");
  });

  it("with the box, the video preview is untouched and the box sits under it", () => {
    const { html } = buildWelcomeEmail({ firstName: "Sam", base, annexure: sign });
    assert.equal(sha(videoBlock(html)), BEFORE.video);
    const video = html.indexOf("email-video.png");
    const box = html.indexOf("One last step: adopt the annexure to your Supervision Guidelines");
    const next = html.indexOf("When you're ready, the easiest way to start");
    assert.ok(video < box && box < next, "video, then the box, then the first steps");
  });

  it("removing the box leaves the welcome as it was", () => {
    const withBox = buildWelcomeEmail({ firstName: "Sam", base, annexure: sign }).html;
    const start = withBox.indexOf("<tr><td style=\"padding:0 28px 22px\">");
    const end = withBox.indexOf("</td></tr></table></td></tr>", start) + "</td></tr></table></td></tr>".length;
    assert.equal(sha(withBox.slice(0, start) + withBox.slice(end + 1)), BEFORE.html);
  });

  it("shows the brief's words, the office's details and a green Review and sign button", () => {
    const { html } = buildWelcomeEmail({ firstName: "Sam", base, annexure: sign });
    for (const words of [
      "One last step: adopt the annexure to your Supervision Guidelines",
      "It records how your agency uses RealComply within your existing supervision system. You stay in charge of your agency&#39;s compliance.".replace("&#39;", "'"),
      "Harbour Realty",
      "10012345",
      "14 October 2026",
      "Review and sign",
      "Opens a secure page. Takes about two minutes.",
    ]) {
      assert.ok(html.includes(words), words);
    }
    assert.ok(html.includes(`href="${sign.kind === "sign" ? sign.url : ""}"`));
    assert.ok(html.includes("border:2px solid #0b7d50"), "the green border");
  });

  it("gives the plain-text version a link instead of the button", () => {
    const { text } = buildWelcomeEmail({ firstName: "Sam", base, annexure: sign });
    assert.ok(text.includes(`Review and sign: ${sign.kind === "sign" ? sign.url : ""}`));
    assert.ok(text.includes("Agency: Harbour Realty"));
    assert.ok(text.includes("Licence number: 10012345"));
  });

  it("with no licence number on file, says they add it when they sign", () => {
    const { html, text } = buildWelcomeEmail({
      firstName: "Sam",
      base,
      annexure: { ...sign, licenceNumber: null } as AnnexureBox,
    });
    assert.ok(html.includes("Add it when you sign"));
    assert.ok(text.includes("Licence number: Add it when you sign"));
  });

  it("when the person who signed up isn't the licensee, says who it went to, with no button", () => {
    const { html, text } = buildWelcomeEmail({ firstName: "Sam", base, annexure: { kind: "sent", licenseeName: "Lee Licensee" } });
    assert.ok(html.includes("We&#39;ve sent the annexure to Lee Licensee to sign.".replace("&#39;", "'")));
    assert.ok(text.includes("We've sent the annexure to Lee Licensee to sign."));
    assert.ok(!html.includes("Review and sign"));
  });
});

describe("the box for an agent on their own plan (CORRECTION, 14 Oct 2026)", () => {
  const download: AnnexureBox = { kind: "download", url: `${base}/annexure/download` };

  it("is the download link and the one line, word for word, under the video", () => {
    const { html, text } = buildWelcomeEmail({ firstName: "Sam", base, annexure: download });
    assert.ok(html.includes(`href="${base}/annexure/download"`));
    assert.ok(html.includes("Download the annexure for your licensee"));
    const line = "Please give this to your licensee in charge. It explains how RealComply fits within your agency's supervision system.";
    assert.ok(html.includes(line.replace("'", "&#39;")) || html.includes(line));
    assert.ok(text.includes(`Download the annexure for your licensee (PDF): ${base}/annexure/download`));
    assert.ok(text.includes(line));
    assert.equal(sha(videoBlock(html)), BEFORE.video, "the video untouched");
    assert.ok(html.indexOf("email-video.png") < html.indexOf("Download the annexure for your licensee"));
  });

  it("asks nothing of a licensee: no heading about adopting, no button, nothing about sending", () => {
    const { html, text } = buildWelcomeEmail({ firstName: "Sam", base, annexure: download });
    for (const words of ["One last step", "Review and sign", "We've sent the annexure", "We&#39;ve sent the annexure"]) {
      assert.ok(!html.includes(words) && !text.includes(words), words);
    }
    assert.ok(!/[—–]/.test(text));
  });
});

describe("the short email asking the licensee to sign", () => {
  it("greets the licensee, names the office, and carries the same box", () => {
    const { subject, html, text } = buildAnnexureRequestEmail({
      licenseeName: "lee licensee",
      box: sign as Extract<AnnexureBox, { kind: "sign" }>,
      base,
    });
    assert.equal(subject, "Adopt the RealComply annexure for Harbour Realty");
    assert.ok(text.startsWith("Hi Lee,"));
    assert.ok(html.includes("One last step: adopt the annexure to your Supervision Guidelines"));
    assert.ok(text.includes(`Review and sign: ${sign.kind === "sign" ? sign.url : ""}`));
  });
});

describe("the signed copy's email", () => {
  it("thanks them by first name and says where it is kept", () => {
    const { subject, text } = buildAnnexureSignedEmail({ signedName: "Lee Licensee", agencyName: "Harbour Realty", base });
    assert.equal(subject, "Signed: annexure to the Supervision Guidelines, Harbour Realty");
    assert.ok(text.startsWith("Hi Lee,"));
    assert.ok(text.includes("Your signed copy is attached. Add it to your Supervision Guidelines."));
    assert.ok(text.includes("Registers, Document sign-offs"));
  });
});

describe("no em dashes in what a customer reads", () => {
  it("in any of the annexure emails", () => {
    const all = [
      buildWelcomeEmail({ firstName: "Sam", base, annexure: sign }).text,
      buildWelcomeEmail({ firstName: "Sam", base, annexure: { kind: "sent", licenseeName: "Lee" } }).text,
      buildAnnexureRequestEmail({ licenseeName: "Lee", box: sign as Extract<AnnexureBox, { kind: "sign" }>, base }).text,
      buildAnnexureSignedEmail({ signedName: "Lee", agencyName: "Harbour Realty", base }).text,
    ];
    for (const t of all) assert.ok(!/[—–]/.test(t));
  });
});
