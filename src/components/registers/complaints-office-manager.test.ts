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
    assert.ok(html.includes("Add files"));
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

  it("Review, Resolve, removing a file and removing a complaint: the licensee in charge only", () => {
    for (const fn of [
      body(registers, "updateComplaintStatus"),
      body(registers, "deleteComplaint"),
      body(filesActions, "removeComplaintFile"),
    ]) {
      assert.match(fn, /if \(!access\.officeLicensee\) return/);
      assert.doesNotMatch(fn, /seesComplaints/);
    }
  });
});
