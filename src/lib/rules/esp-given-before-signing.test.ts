import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ESP_GIVEN_AFTER_SIGNING,
  ESP_GIVEN_MISSING,
  espGivenAfterSigning,
  espGivenApplies,
  espGivenMissing,
  espGivenOf,
  espNoticeOf,
} from "./esp-given-before-signing";
import type { PropertyItem } from "@/lib/types";

const before17 = new Date("2026-11-10T09:00:00+11:00");
const after17 = new Date("2026-11-20T09:00:00+11:00");
const row = (data: Record<string, unknown>) => ({ data }) as Pick<PropertyItem, "data">;

describe("the ESP and evidence given before signing (s72A(2), from 17 Nov 2026)", () => {
  it("applies to agreements signed from 17 November; with no signing date, from today", () => {
    assert.equal(espGivenApplies("2026-11-16", after17), false, "signed the day before");
    assert.equal(espGivenApplies("2026-11-17", after17), true, "signed on the day");
    assert.equal(espGivenApplies("2026-11-17", before17), false, "nothing before midnight on 17 November, whatever date was typed");
    assert.equal(espGivenApplies(null, before17), false);
    assert.equal(espGivenApplies(null, after17), true);
    assert.equal(espGivenApplies("not a date", after17), true, "an unreadable date counts as none");
  });

  it("Mark done needs the date, from 17 November only", () => {
    assert.equal(espGivenMissing(null, "2026-11-18", after17), ESP_GIVEN_MISSING);
    assert.equal(espGivenMissing("", null, after17), ESP_GIVEN_MISSING);
    assert.equal(espGivenMissing("2026-11-17", "2026-11-18", after17), null);
    assert.equal(espGivenMissing(null, "2026-11-10", after17), null, "an agreement signed before 17 November");
    assert.equal(espGivenMissing(null, null, before17), null);
  });

  it("flags a date after the signing date; the same day or before is fine", () => {
    assert.equal(espGivenAfterSigning("2026-11-19", "2026-11-18", after17), ESP_GIVEN_AFTER_SIGNING);
    assert.equal(espGivenAfterSigning("2026-11-18", "2026-11-18", after17), null);
    assert.equal(espGivenAfterSigning("2026-11-15", "2026-11-18", after17), null);
    assert.equal(espGivenAfterSigning("2026-11-19", null, after17), null, "nothing to compare with yet");
    assert.equal(espGivenAfterSigning("2026-11-12", "2026-11-10", after17), null, "signed before 17 November");
    assert.match(ESP_GIVEN_AFTER_SIGNING, /\(s72A\)/);
    assert.doesNotMatch(ESP_GIVEN_AFTER_SIGNING + ESP_GIVEN_MISSING, /—/);
  });

  it("reads the date and the notice off the card", () => {
    assert.equal(espGivenOf(row({ espGivenOn: "2026-11-17" })), "2026-11-17");
    assert.equal(espGivenOf(row({ espGivenOn: "17/11/2026" })), null);
    assert.equal(espGivenOf(null), null);
    assert.deepEqual(espNoticeOf(row({ espNoticePath: "o/p/a4/1-esp.pdf", espNoticeFileName: "ESP notice.pdf" })), {
      path: "o/p/a4/1-esp.pdf",
      name: "ESP notice.pdf",
    });
    assert.deepEqual(espNoticeOf(row({ espNoticePath: "o/p/a4/esp.pdf" })), { path: "o/p/a4/esp.pdf", name: "esp.pdf" });
    assert.equal(espNoticeOf(row({})), null);
  });
});
