import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_FILE_MESSAGE, fileReadsEmpty } from "./empty-file";
import { EVIDENCE_BUCKET, evidenceFileProblem, storedFileProblem, storedFileSize, uploadEvidenceObject } from "./evidence";

// Empty files are refused on every upload (Adam, 19 Oct 2026). Found on a live
// listing: two PDFs saved as 0-byte files and taken as done.

describe("the message", () => {
  it("is Adam's wording, word for word, with no em dash", () => {
    assert.equal(
      EMPTY_FILE_MESSAGE,
      "This file came through empty. You may be trying to upload a file stored in a cloud-based location. Download it to your computer, check it opens, then upload it again.",
    );
    assert.ok(!EMPTY_FILE_MESSAGE.includes("—"));
  });
});

describe("on screen, when the file is chosen", () => {
  it("a 0-byte file of an accepted type is refused with the message", () => {
    assert.equal(evidenceFileProblem({ name: "Market Appraisal.pdf", type: "application/pdf", size: 0 }), EMPTY_FILE_MESSAGE);
    assert.equal(evidenceFileProblem({ name: "offer.msg", type: "", size: 0 }), EMPTY_FILE_MESSAGE);
  });

  it("a one-byte file is not empty", () => {
    assert.equal(evidenceFileProblem({ name: "agreement.pdf", type: "application/pdf", size: 1 }), null);
  });

  it("reads the first byte, so a file whose size says one thing and whose bytes another is caught", async () => {
    assert.equal(await fileReadsEmpty(new Blob([])), true);
    assert.equal(await fileReadsEmpty(new Blob(["%PDF-1.7"])), false);

    // A file still in a cloud drive: it reports a size, then hands over nothing.
    const placeholder = { size: 52_000, slice: () => new Blob([]) } as unknown as Blob;
    assert.equal(await fileReadsEmpty(placeholder), true);

    // One the browser cannot read at all.
    const unreadable = {
      size: 52_000,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }),
    } as unknown as Blob;
    assert.equal(await fileReadsEmpty(unreadable), true);
  });
});

describe("before the upload", () => {
  it("nothing empty is sent to Storage", async () => {
    let uploads = 0;
    const client = {
      storage: { from: () => ({ upload: async () => ((uploads += 1), { error: null }) }) },
    } as unknown as SupabaseClient;
    const empty = new File([], "Exclusive Sales Agreement.pdf", { type: "application/pdf" });

    const { error } = await uploadEvidenceObject(client, { path: "ag/p1/a3/1-x.pdf", file: empty });

    assert.equal(error, EMPTY_FILE_MESSAGE);
    assert.equal(uploads, 0);
  });
});

// Storage as the server asks it: info() first, the folder listing if info
// does not answer.
function storage(opts: {
  info?: { data: unknown; error: unknown } | "throws";
  list?: { data: unknown; error: unknown };
}) {
  const asked: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, EVIDENCE_BUCKET);
        return {
          async info(path: string) {
            asked.push(`info ${path}`);
            if (opts.info === "throws") throw new Error("network");
            return opts.info ?? { data: null, error: { message: "not found" } };
          },
          async list(folder: string, { search }: { search: string }) {
            asked.push(`list ${folder} ${search}`);
            return opts.list ?? { data: [], error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, asked };
}

describe("on the server, by the size Storage holds", () => {
  const PATH = "ag/p1/a4/1791954642399-Market_Appraisal.pdf";

  it("refuses a stored file of 0 bytes, whatever the browser said", async () => {
    const { client } = storage({ info: { data: { size: 0 }, error: null } });
    assert.equal(await storedFileProblem(client, PATH), EMPTY_FILE_MESSAGE);
  });

  it("accepts a file with something in it", async () => {
    const { client } = storage({ info: { data: { size: 2_976_040 }, error: null } });
    assert.equal(await storedFileProblem(client, PATH), null);
  });

  it("reads the size from the folder listing when info does not answer", async () => {
    const { client, asked } = storage({
      info: "throws",
      list: { data: [{ name: "1791954642399-Market_Appraisal.pdf", metadata: { size: 0 } }], error: null },
    });
    assert.equal(await storedFileSize(client, PATH), 0);
    assert.deepEqual(asked, [`info ${PATH}`, "list ag/p1/a4 1791954642399-Market_Appraisal.pdf"]);
  });

  it("only the file itself counts in the listing, not one whose name starts the same", async () => {
    const { client } = storage({
      list: { data: [{ name: "1791954642399-Market_Appraisal.pdf.bak", metadata: { size: 0 } }], error: null },
    });
    assert.equal(await storedFileSize(client, PATH), null);
  });

  it("lets the file through when Storage cannot say, so a slow answer never stops a real upload", async () => {
    const { client } = storage({ info: "throws", list: { data: null, error: { message: "timeout" } } });
    assert.equal(await storedFileProblem(client, PATH), null);
  });
});

// Every server action that records an uploaded file asks Storage its size
// first. A new one added later should be added here, and to the check.
describe("every server action that records an upload asks the size", () => {
  const CHECKED: Array<[file: string, fn: string]> = [
    ["src/lib/actions/compliance.ts", "uploadEvidence"],
    ["src/lib/actions/compliance.ts", "addReportEntry"],
    ["src/lib/actions/properties.ts", "createProperty"],
    ["src/lib/actions/licences.ts", "attachLicenceDocument"],
    ["src/lib/actions/licences.ts", "attachCorporationLicenceDocument"],
    ["src/lib/actions/insurance.ts", "attachInsuranceCertificate"],
    ["src/lib/actions/insurance.ts", "addOtherInsurance"],
    ["src/lib/actions/insurance.ts", "attachOtherInsuranceCertificate"],
    ["src/lib/actions/registers.ts", "attachCpdCertificate"],
    ["src/lib/actions/registers.ts", "addCpdFromCertificate"],
    ["src/lib/actions/registers.ts", "finalizeCpdEvidence"],
    ["src/lib/actions/registers.ts", "addSgManualVersion"],
    ["src/lib/actions/signoffs.ts", "createSignoffDocument"],
    ["src/lib/actions/signoffs.ts", "replaceSignoffDocument"],
    ["src/lib/actions/trust-account.ts", "saveTrustAudit"],
    ["src/lib/actions/training-plans.ts", "attachPlanItemDocument"],
    ["src/lib/actions/agent-acknowledgement.ts", "recordSignedAnnexure"],
    ["src/lib/actions/team.ts", "saveAgencyLogo"],
    ["src/lib/storage/evidence.ts", "finalizeEvidenceRecord"],
  ];

  /** The text of one exported function, up to the next top-level declaration. */
  function body(file: string, fn: string): string {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} not found in ${file}`);
    const rest = source.slice(start + 1);
    const end = rest.search(/\n(export |async function |function |const |type )/);
    return end < 0 ? rest : rest.slice(0, end);
  }

  for (const [file, fn] of CHECKED) {
    it(fn, () => {
      assert.match(body(file, fn), /storedFileProblem|refuseEmpty/, `${fn} saves an upload without asking its size`);
    });
  }
});
