import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, photoNoticeFlags, photoNoticeMissing } from "./tenant-photo-notice";

const permitted = { shootDate: "2026-10-09", permissionGiven: true, permissionDate: "2026-10-10" };

describe("photoNoticeMissing", () => {
  it("needs the notice date, the shoot date and an answer on permission", () => {
    assert.equal(photoNoticeMissing({ noticeDate: null, data: {} }).length, 3);
  });
  it("needs a date once permission is ticked", () => {
    assert.deepEqual(
      photoNoticeMissing({ noticeDate: "2026-10-02", data: { ...permitted, permissionDate: null } }),
      ["Enter the date the tenant gave permission."],
    );
  });
  it("accepts permission with a date, and needs no upload", () => {
    assert.deepEqual(photoNoticeMissing({ noticeDate: "2026-10-02", data: permitted }), []);
  });
  it("accepts no belongings in shot in place of permission", () => {
    assert.deepEqual(
      photoNoticeMissing({ noticeDate: "2026-10-02", data: { shootDate: "2026-10-09", noBelongings: true } }),
      [],
    );
  });
});

describe("photoNoticeFlags", () => {
  it("passes exactly 7 days' notice", () => {
    assert.equal(daysBetween("2026-10-02", "2026-10-09"), 7);
    assert.deepEqual(photoNoticeFlags({ noticeDate: "2026-10-02", data: permitted, launchDate: null }), []);
  });
  it("flags less than 7 days' notice", () => {
    const flags = photoNoticeFlags({
      noticeDate: "2026-10-02",
      data: { ...permitted, shootDate: "2026-10-06" },
      launchDate: null,
    });
    assert.equal(flags.length, 1);
    assert.match(flags[0], /Only 4 days/);
  });
  it("flags permission more than 3 weeks older than the launch", () => {
    const flags = photoNoticeFlags({
      noticeDate: "2026-10-02",
      data: { ...permitted, permissionDate: "2026-09-10" },
      launchDate: "2026-10-14",
    });
    assert.match(flags[0], /34 days older/);
  });
  it("passes permission exactly 3 weeks before the launch", () => {
    assert.deepEqual(
      photoNoticeFlags({ noticeDate: "2026-10-02", data: { ...permitted, permissionDate: "2026-09-23" }, launchDate: "2026-10-14" }),
      [],
    );
  });
  it("flags permission dated after the launch", () => {
    const flags = photoNoticeFlags({
      noticeDate: "2026-10-02",
      data: { ...permitted, permissionDate: "2026-10-20" },
      launchDate: "2026-10-14",
    });
    assert.match(flags[0], /after the listing went live/);
  });
  it("ignores permission dates when no belongings are in shot", () => {
    assert.deepEqual(
      photoNoticeFlags({
        noticeDate: "2026-10-02",
        data: { shootDate: "2026-10-09", noBelongings: true, permissionDate: "2026-01-01" },
        launchDate: "2026-10-14",
      }),
      [],
    );
  });
});
