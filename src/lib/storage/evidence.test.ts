import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVIDENCE_BUCKET, cpdFolder, isInFolder, listingFolder, listPropertyEvidencePaths } from "./evidence";

// A bucket as storage.list() shows it: one level at a time, a folder with no
// id, paged by limit/offset.
function fakeClient(objects: string[], failOn?: string) {
  const listed: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, EVIDENCE_BUCKET);
        return {
          async list(prefix: string, { limit, offset }: { limit: number; offset: number }) {
            listed.push(prefix);
            if (prefix === failOn) return { data: null, error: { message: "denied" } };
            const names = new Map<string, boolean>();
            for (const path of objects) {
              if (!path.startsWith(`${prefix}/`)) continue;
              const [first, ...rest] = path.slice(prefix.length + 1).split("/");
              names.set(first, rest.length === 0 || names.get(first) === true);
            }
            const entries = [...names.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null }));
            return { data: entries.slice(offset, offset + limit), error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, listed };
}

describe("listPropertyEvidencePaths", () => {
  it("finds every file under the listing, in every item folder", async () => {
    const { client } = fakeClient([
      "ag/p1/a3/1-agreement.pdf",
      "ag/p1/f3/2-building-pest.pdf",
      "ag/p1/x7/3-evidence.pdf",
      "ag/p1/x7/4-evidence-replaced.pdf",
      "ag/p2/a3/5-other-listing.pdf",
      "ag/_licences/u1/6-licence.pdf",
    ]);
    const paths = await listPropertyEvidencePaths(client, "ag", "p1");
    assert.deepEqual(paths.sort(), [
      "ag/p1/a3/1-agreement.pdf",
      "ag/p1/f3/2-building-pest.pdf",
      "ag/p1/x7/3-evidence.pdf",
      "ag/p1/x7/4-evidence-replaced.pdf",
    ]);
  });

  it("reads past the first page of a folder", async () => {
    const many = Array.from({ length: 230 }, (_, i) => `ag/p1/f3/${String(i).padStart(3, "0")}.pdf`);
    const { client } = fakeClient(many);
    const paths = await listPropertyEvidencePaths(client, "ag", "p1");
    assert.equal(paths.length, 230);
  });

  it("throws rather than call an unreadable folder empty", async () => {
    const { client } = fakeClient(["ag/p1/a3/1.pdf"], "ag/p1/a3");
    await assert.rejects(() => listPropertyEvidencePaths(client, "ag", "p1"), /could not list ag\/p1\/a3/);
  });
});

test("isInFolder: only a path inside the record's own folder", () => {
  const folder = listingFolder("ag", "p1");
  assert.equal(isInFolder("ag/p1/a1/1-voi.pdf", folder), true);
  assert.equal(isInFolder("ag/p2/b1/9-contract.pdf", folder), false);
  assert.equal(isInFolder("ag/p1", folder), false);
  assert.equal(isInFolder("ag/p10/a1/x.pdf", folder), false);
  assert.equal(isInFolder("ag/p1/../p2/b1/x.pdf", folder), false);
  assert.equal(isInFolder("ag/p1/a1/" + "x".repeat(1100), folder), false);
  assert.equal(isInFolder("ag/_cpd/me/1-cert.pdf", cpdFolder("ag", "me")), true);
  assert.equal(isInFolder("ag/_cpd/you/1-cert.pdf", cpdFolder("ag", "me")), false);
});
