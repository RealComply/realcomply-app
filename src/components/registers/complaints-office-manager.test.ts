import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Complaint, ComplaintFile, Profile, Property } from "@/lib/types";

// Office managers on the Complaints register (Adam, 31 Oct 2026: "adding and
// read only"; 0102). They read the whole register and its files, log
// complaints and add files. Review, Resolve, removing a file and removing a
// complaint stay with the licensee in charge. Made-up office, people and
// complaints throughout. .tsx needs the repo's load hook, as in
// comparables/draft-disclaimer.test.ts.
register("../../../scripts/tsx-hooks.mjs", import.meta.url);

type PanelUi = typeof import("./ComplaintsPanel");
type FilesUi = typeof import("./ComplaintFiles");
let panelUi: PanelUi;
let filesUi: FilesUi;
before(async () => {
  panelUi = (await import("./ComplaintsPanel.tsx" as string)) as PanelUi;
  filesUi = (await import("./ComplaintFiles.tsx" as string)) as FilesUi;
});

const OFFICE = "11111111-1111-4111-8111-111111111111";
const LEE = "44444444-4444-4444-8444-444444444444"; // licensee in charge
const MAX = "55555555-5555-4555-8555-555555555555"; // office manager
const OWN_LISTING = "66666666-6666-4666-8666-666666666666";
const OTHER_LISTING = "77777777-7777-4777-8777-777777777777";

const viewer = { id: MAX, agency_id: OFFICE, is_licensee_in_charge: false } as unknown as Profile;
const listing = { id: OWN_LISTING, address: "1 Made Up Street, Nowhere" } as unknown as Property;

const complaint = (over: Partial<Complaint>): Complaint =>
  ({
    id: "c-open",
    agency_id: OFFICE,
    received_date: "2026-10-12",
    complainant: "K. Adams, buyer (made up)",
    agent_id: null,
    property_id: null,
    nature: "Not told about the strata report",
    status: "open",
    resolved_date: null,
    notes: null,
    created_by: LEE,
    created_at: "2026-10-12T01:00:00Z",
    ...over,
  }) as Complaint;

const file = (over: Partial<ComplaintFile>): ComplaintFile => ({
  id: "f1",
  agency_id: OFFICE,
  complaint_id: "c-open",
  file_path: `${OFFICE}/_complaints/c-open/1-complaint-email.eml`,
  file_name: "complaint-email.eml",
  size_bytes: 2048,
  added_by: LEE,
  added_at: "2026-10-30T03:14:00Z",
  removed_at: null,
  removed_by: null,
  ...over,
});

function panel(canChange: boolean, complaints: Complaint[] = [complaint({})]): string {
  return renderToStaticMarkup(
    createElement(panelUi.ComplaintsPanel, {
      complaints,
      staff: [],
      properties: [listing],
      viewerProfile: viewer,
      canChange,
      nameOf: { [LEE]: "Lee Licensee", [MAX]: "Max Manager" },
      resolutionTargetDays: 30,
      files: [],
      filesReady: true,
    }),
  );
}

function files(canRemove: boolean): string {
  return renderToStaticMarkup(
    createElement(filesUi.ComplaintFiles, {
      agencyId: OFFICE,
      complaintId: "c-open",
      current: [file({})],
      removed: [
        file({
          id: "f2",
          file_name: "wrong-file.pdf",
          file_path: `${OFFICE}/_complaints/c-open/2-wrong-file.pdf`,
          removed_at: "2026-10-30T03:20:00Z",
          removed_by: LEE,
        }),
      ],
      urlByPath: { [`${OFFICE}/_complaints/c-open/1-complaint-email.eml`]: "https://example.invalid/signed" },
      nameOf: { [LEE]: "Lee Licensee" },
      canRemove,
    }),
  );
}

describe("the Complaints register for an office manager (adding and read only)", () => {
  it("shows the whole register, with Log a complaint and the files", () => {
    const html = panel(false);
    assert.ok(html.includes("K. Adams, buyer (made up)"));
    assert.ok(html.includes("Not told about the strata report"));
    assert.ok(html.includes("+ Log a complaint"));
    assert.ok(html.includes("Add a file"));
  });

  it("has no Review, Resolve or Remove, and says who does those", () => {
    const html = panel(false, [complaint({}), complaint({ id: "c-review", status: "under_review" })]);
    assert.ok(!html.includes(">Review</button>"));
    assert.ok(!html.includes(">Resolve</button>"));
    assert.ok(!html.includes(">Remove<"));
    assert.ok(
      html.includes("You can log complaints and add files. Review, Resolve and removing are for the licensee in charge."),
    );
  });

  it("says a complaint is linked to a listing they can't open, without its address", () => {
    const html = panel(false, [
      complaint({ id: "c-own", property_id: OWN_LISTING }),
      complaint({ id: "c-other", property_id: OTHER_LISTING }),
    ]);
    assert.ok(html.includes(`href="/dashboard/${OWN_LISTING}"`));
    assert.ok(html.includes("1 Made Up Street, Nowhere"));
    assert.ok(html.includes("A listing you can&#x27;t open"));
    assert.ok(!html.includes(`/dashboard/${OTHER_LISTING}`));
  });

  it("opens each file and adds new ones, but has no Remove", () => {
    const html = files(false);
    assert.ok(html.includes("complaint-email.eml"));
    assert.ok(html.includes('href="https://example.invalid/signed"'));
    assert.ok(html.includes("Attach file"));
    assert.ok(!html.includes(">Remove</button>"));
  });

  it("still sees each removed file, with who removed it and when", () => {
    const html = files(false);
    assert.ok(html.includes("wrong-file.pdf"));
    assert.ok(html.includes("Removed 30 Oct 2026, 2:20 pm by Lee Licensee"));
  });
});

describe("the Complaints register for the licensee in charge (unchanged)", () => {
  it("keeps Review, Resolve and Remove, without the office manager's line", () => {
    const html = panel(true);
    assert.ok(html.includes(">Review</button>"));
    assert.ok(html.includes(">Resolve</button>"));
    assert.ok(html.includes(">Remove</button>"));
    assert.ok(!html.includes("You can log complaints and add files."));
  });

  it("keeps Remove on each file", () => {
    assert.ok(files(true).includes(">Remove</button>"));
  });
});

// "Add a file" on every complaint, open or resolved, for the licensee in
// charge and the office manager (Adam, 10 Nov 2026: he couldn't see it on a
// logged complaint). It was a button in the far-right column of a table that
// scrolled sideways, off the edge of anything narrower than about 1,250px.
// Then: "the columns don't work. the layout needs to be much easier to read".
// Now one card per complaint, open ones first, nothing sideways.
describe("Add a file on every complaint", () => {
  const every = [
    complaint({ id: "c-open" }),
    complaint({ id: "c-review", status: "under_review" }),
    complaint({ id: "c-resolved", status: "resolved", resolved_date: "2026-10-20", resolved_at: "2026-10-20T01:00:00Z" }),
    complaint({
      id: "c-signed",
      status: "resolved",
      resolved_date: "2026-10-01",
      resolved_at: "2026-10-01T01:00:00Z",
      signed_off_by: LEE,
      signed_off_at: "2026-10-02T01:00:00Z",
      signed_off_via: "app",
    }),
  ];
  const render = (who: "licensee" | "office manager", withFiles: ComplaintFile[] = []) =>
    renderToStaticMarkup(
      createElement(panelUi.ComplaintsPanel, {
        complaints: every,
        staff: [],
        properties: [listing],
        viewerProfile: viewer,
        canChange: who === "licensee",
        canMoveOn: true,
        canSignOff: who === "licensee",
        nameOf: { [LEE]: "Lee Licensee", [MAX]: "Max Manager" },
        resolutionTargetDays: 30,
        files: withFiles,
        filesReady: true,
      }),
    );
  const count = (html: string, text: string) => html.split(text).length - 1;

  for (const who of ["licensee", "office manager"] as const) {
    it(`the ${who}: one on each of the 4 complaints, open, under review, resolved and signed off`, () => {
      const html = render(who);
      assert.equal(count(html, "Add a file"), 4);
      assert.equal(count(html, "data-complaint="), 4, "one card each");
      assert.ok(!html.includes("<table"), "no columns, nothing to scroll sideways");
      // Each card's own Add a file, inside that card.
      for (const id of ["c-open", "c-review", "c-resolved", "c-signed"]) {
        const at = html.indexOf(`data-complaint="${id}"`);
        const next = html.indexOf("data-complaint=", at + 1);
        assert.ok(html.slice(at, next < 0 ? undefined : next).includes("Add a file"), id);
      }
    });
  }

  it("open ones first, under their own headings, with plain dates", () => {
    const html = render("licensee");
    const openAt = html.indexOf("Open (2)");
    const resolvedAt = html.indexOf("Resolved (2)");
    assert.ok(openAt >= 0 && resolvedAt > openAt);
    assert.ok(html.indexOf('data-complaint="c-review"') < resolvedAt);
    assert.ok(html.indexOf('data-complaint="c-resolved"') > resolvedAt);
    assert.ok(html.includes("Received 12 October 2026"));
    assert.ok(!html.includes(">2026-10-12<"), "no raw dates");
  });

  it("says how long an open one has been open, and when it's past the office's target", () => {
    const html = renderToStaticMarkup(
      createElement(panelUi.ComplaintsPanel, {
        complaints: [
          complaint({ id: "c-late", received_date: "2026-01-05" }),
          complaint({ id: "c-done", status: "resolved", received_date: "2026-01-05", resolved_at: "2026-01-09T01:00:00Z" }),
        ],
        staff: [],
        properties: [],
        viewerProfile: viewer,
        nameOf: {},
        resolutionTargetDays: 30,
        files: [],
        filesReady: true,
      }),
    );
    const late = html.slice(html.indexOf('data-complaint="c-late"'), html.indexOf('data-complaint="c-done"'));
    assert.match(late, /\d+ days open, past the 30-day target/);
    assert.ok(!html.slice(html.indexOf('data-complaint="c-done"')).includes("days open"), "not on a resolved one");
  });

  it("shows the agent, the listing and the notes, which the old table never showed", () => {
    const html = renderToStaticMarkup(
      createElement(panelUi.ComplaintsPanel, {
        complaints: [complaint({ agent_id: LEE, property_id: OWN_LISTING, notes: "Called them back on the 13th." })],
        staff: [],
        properties: [listing],
        viewerProfile: viewer,
        nameOf: { [LEE]: "Lee Licensee" },
        resolutionTargetDays: 30,
        files: [],
        filesReady: true,
      }),
    );
    assert.ok(html.includes("Agent: Lee Licensee"));
    assert.ok(html.includes(`href="/dashboard/${OWN_LISTING}"`));
    assert.ok(html.includes("Called them back on the 13th."));
  });

  it("with files on it, says how many and still offers Add a file", () => {
    const html = render("office manager", [file({ complaint_id: "c-signed" })]);
    assert.ok(html.includes("1 file · Add a file"));
    assert.equal(count(html, "Add a file"), 4);
  });

  it("before 0101 has run, no files line at all", () => {
    const html = renderToStaticMarkup(
      createElement(panelUi.ComplaintsPanel, {
        complaints: every,
        staff: [],
        properties: [listing],
        viewerProfile: viewer,
        canChange: true,
        nameOf: {},
        resolutionTargetDays: 30,
        files: [],
        filesReady: false,
      }),
    );
    assert.ok(!html.includes("Add a file"));
  });
});

// The server actions decide too: adding asks seesComplaints (the licensee in
// charge or an office manager), changing and removing ask officeLicensee.
// The database refuses the rest whatever calls it (0101, 0102).
function body(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("who each complaint action lets through", () => {
  const registers = readFileSync(new URL("../../lib/actions/registers.ts", import.meta.url), "utf8");
  const filesActions = readFileSync(new URL("../../lib/actions/complaint-files.ts", import.meta.url), "utf8");

  it("logging a complaint and adding a file: the licensee in charge or an office manager", () => {
    for (const fn of [body(registers, "addComplaint"), body(filesActions, "addComplaintFile")]) {
      assert.match(fn, /if \(!access\.seesComplaints\) return/);
      assert.doesNotMatch(fn, /officeLicensee/);
    }
  });

  it("a new complaint always starts open", () => {
    assert.match(body(registers, "addComplaint"), /status: "open",/);
  });

  it("removing a file and removing a complaint: the licensee in charge only", () => {
    for (const fn of [body(registers, "deleteComplaint"), body(filesActions, "removeComplaintFile")]) {
      assert.match(fn, /if \(!access\.officeLicensee\) return/);
      assert.doesNotMatch(fn, /seesComplaints/);
    }
  });

  // REVERSAL (Adam, 3 Nov 2026; 0108). Was: Review and Resolve were the
  // licensee in charge's only. Now an office manager marks a complaint Under
  // review or Resolved too; only the licensee takes one back to open, and only
  // the licensee signs a resolved complaint off.
  it("Under review and Resolved: the licensee in charge or an office manager; reopening and signing off: the licensee", () => {
    assert.match(
      body(registers, "updateComplaintStatus"),
      /if \(!access\.officeLicensee && !\(access\.isOfficeManager && status !== "open"\)\) return/,
    );
    assert.match(body(registers, "signOffComplaint"), /if \(!access\.officeLicensee\) return \{ error:/);
  });
});
