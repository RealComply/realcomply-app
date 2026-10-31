import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { complaintsRegisterShown } from "./complaints-register";

// Who sees the Complaints register (Adam, 31 Oct 2026: an office manager,
// "adding and read only"; 0102). Until 0102 has run the database gives an
// office manager none of it, so they don't get the register at all rather
// than one that says "No complaints logged.".

function stub(error: { message: string } | null) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  return {
    calls,
    rpc: (async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: error ? null : false, error };
    }) as never,
  };
}

describe("complaintsRegisterShown", () => {
  it("the licensee in charge always, without asking the database", async () => {
    const db = stub(null);
    assert.equal(await complaintsRegisterShown(db, { officeLicensee: true, seesComplaints: true }), true);
    assert.equal(db.calls.length, 0);
  });

  it("an office manager once 0102 has run", async () => {
    const db = stub(null);
    assert.equal(await complaintsRegisterShown(db, { officeLicensee: false, seesComplaints: true }), true);
    assert.deepEqual(db.calls, [{ fn: "complaint_file_addable", args: { p_name: "" } }]);
  });

  it("not an office manager before 0102 has run", async () => {
    const db = stub({ message: "Could not find the function public.complaint_file_addable(p_name) in the schema cache" });
    assert.equal(await complaintsRegisterShown(db, { officeLicensee: false, seesComplaints: true }), false);
  });

  it("never an agent, an assistant or an agent on their own plan", async () => {
    const db = stub(null);
    assert.equal(await complaintsRegisterShown(db, { officeLicensee: false, seesComplaints: false }), false);
    assert.equal(db.calls.length, 0);
  });
});
