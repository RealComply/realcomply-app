import { Suspense } from "react";
import { logout } from "@/lib/actions/auth";
import type { Profile } from "@/lib/types";
import type { EndedState } from "@/lib/subscription-end/access";
import { daysLeft, deletionDate, longDate, sydneyDate } from "@/lib/subscription-end/dates";
import { legalHoldLine } from "@/lib/subscription-end/emails";
import type { RecordsListing } from "@/lib/subscription-end/records";
import { DownloadAll } from "./DownloadAll";
import { ReactivateButton } from "./ReactivateButton";
import { ReactivatedNotice } from "./ReactivatedNotice";

// The records page: the only page an agency sees once its subscription has
// ended (brief of 8 Oct 2026, item 2; mockup approved by Adam the same day).
// No menu, no assistant, nothing that adds or changes anything.
//
// One departure from the mockup, decided by Adam on 8 Oct: the closing note
// says the activity record uses internal identifiers rather than names or
// addresses, because that is what DPA cl 4.9 and the Privacy Policy say.
//
// DARK MODE AND PHONE WIDTH. The rest of the app is light only. This page
// carries its own colour tokens with a dark set, because it is the page
// someone may open from an email on a phone at night, and it has to read.

const STYLES = `
.rec{
  --ground:#eef1ef; --panel:#fff; --ink:#0d1f19; --body:#3d4d47; --muted:#6a7b74;
  --line:#dde3e0; --green:#0ca678; --on-green:#fff;
  --amber:#b7791f; --amber-soft:#fdf6e7; --amber-line:#f0e0bd; --red:#d03b3b;
  --side:#0d1f19; --side-fg:#fff; --side-dim:#a9bdb4;
  background:var(--ground); color:var(--body); min-height:100vh;
  font-size:15px; line-height:1.55;
}
@media (prefers-color-scheme:dark){
  .rec{
    --ground:#0a1614; --panel:#12231f; --ink:#eaf2ee; --body:#bccbc4; --muted:#8fa39a;
    --line:#243f38; --green:#2ecc8f; --on-green:#06231a;
    --amber:#e8b45e; --amber-soft:#2f2617; --amber-line:#5a4626; --red:#f07a7a;
    --side:#06100d; --side-fg:#eaf2ee; --side-dim:#7f978d; color-scheme:dark;
  }
}
.rec-top{background:var(--side);color:var(--side-fg);padding:14px 16px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.rec-logo{font-weight:700;font-size:18px}.rec-logo b{color:#2ecc8f}
.rec-who{margin-left:auto;font-size:13px;color:var(--side-dim);display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.rec-who button{background:none;border:0;color:var(--side-dim);text-decoration:underline;font:inherit;cursor:pointer;padding:0}
.rec-main{max-width:760px;margin:0 auto;padding:28px 16px 56px}
.rec h1{font-size:23px;font-weight:700;color:var(--ink);margin:0 0 6px;letter-spacing:-.01em;text-wrap:balance}
.rec-lead{margin:0 0 20px;max-width:62ch}.rec-lead b{color:var(--ink)}
.rec-box{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}
.rec-box h2{font-size:15px;color:var(--ink);margin:0 0 8px;font-weight:700}
.rec-box ul{margin:8px 0 14px;padding-left:20px;list-style:disc}
.rec-clock{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;background:var(--amber-soft);border:1px solid var(--amber-line);border-radius:14px;padding:14px 18px;margin-bottom:16px;color:var(--ink)}
.rec-clock .d{font-size:22px;font-weight:700;color:var(--amber);font-variant-numeric:tabular-nums;white-space:nowrap}
.rec-btn{display:inline-block;border:1px solid var(--green);color:var(--green);background:var(--panel);font-weight:600;font-size:14px;border-radius:999px;padding:8px 18px;cursor:pointer;text-decoration:none}
.rec-btn-solid{background:var(--green);color:var(--on-green)}
.rec-btn[disabled]{opacity:.7;cursor:progress}
.rec-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.rec-small{font-size:13px;color:var(--muted)}
.rec-error{color:var(--red);font-size:13.5px;margin:10px 0 0;flex-basis:100%}
.rec-box .rec-list{list-style:none;padding:0;margin:0}
.rec-list li{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:9px 0;border-top:1px solid var(--line)}
.rec-list li:first-child{border-top:none}
.rec-list b{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.rec-list .rec-btn{margin-left:auto;font-size:13px;padding:4px 13px}
.rec-note{font-size:13px;color:var(--muted);max-width:68ch;margin:0 0 10px}
`;

export function RecordsView({
  profile,
  state,
  listings,
}: {
  profile: Profile;
  state: EndedState;
  listings: RecordsListing[];
}) {
  const endedOn = longDate(sydneyDate(state.endedAt));
  const deleteOn = deletionDate(state.endedAt);
  const left = daysLeft(state.endedAt, new Date());

  return (
    <div className="rec">
      <style>{STYLES}</style>
      <header className="rec-top">
        <div className="rec-logo">
          Real<b>Comply</b>
        </div>
        <div className="rec-who">
          <span>
            {profile.full_name ?? profile.email} · {state.agencyName}
          </span>
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>

      <main className="rec-main">
        <h1>Your subscription has ended</h1>

        {!state.mayUseRecords ? (
          <>
            <p className="rec-lead">
              {state.agencyName}&rsquo;s subscription ended on <b>{endedOn}</b>, so nothing can be added or changed.
            </p>
            <div className="rec-box">
              <p style={{ margin: 0 }}>
                Contact your licensee in charge. They can download the agency&rsquo;s records or reactivate the
                subscription before <b>{longDate(deleteOn)}</b>.
              </p>
            </div>
          </>
        ) : (
          <>
            <Suspense fallback={null}>
              <ReactivatedNotice />
            </Suspense>

            <p className="rec-lead">
              {state.agencyName}&rsquo;s subscription ended on <b>{endedOn}</b>. You can no longer add or change
              anything, but you can download a complete copy of your records.
            </p>

            <div className="rec-clock">
              <div className="d">
                {left} {left === 1 ? "day" : "days"} left
              </div>
              <div>
                Your records will be permanently deleted on <b>{longDate(deleteOn)}</b>. Download them before then.
              </div>
            </div>

            <div className="rec-box">
              <h2>Download everything</h2>
              <p style={{ margin: 0 }}>One file with all of your records:</p>
              <ul>
                <li>
                  The finalised record for every listing ({listings.length})
                </li>
                <li>Your registers: gifts, complaints and breaches</li>
                <li>Training and CPD records, and licence details</li>
                <li>Trust account reconciliations</li>
                <li>Every document you uploaded</li>
              </ul>
              <DownloadAll agencyName={state.agencyName} />
            </div>

            {listings.length > 0 ? (
              <div className="rec-box">
                <h2>Or download one listing at a time</h2>
                <ul className="rec-list">
                  {listings.map((l) => (
                    <li key={l.id}>
                      <b>{l.address}</b>
                      <span className="rec-small">{l.stageLabel}</span>
                      <a className="rec-btn" href={`/dashboard/records/listing/${l.id}`} download>
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rec-box" id="reactivate">
              <h2>Changed your mind?</h2>
              <p style={{ margin: "0 0 12px" }}>
                Reactivate before {longDate(deleteOn)} and everything comes back exactly as it was.
              </p>
              <ReactivateButton />
            </div>

            <p className="rec-note">{legalHoldLine(deleteOn)}</p>
            <p className="rec-note">
              Keeping the records the law requires is your responsibility. After {longDate(deleteOn)} RealComply will
              hold only an activity record of what was checked, flagged and signed off, and when. It uses internal
              identifiers rather than names or addresses, contains no documents, and is kept for 7 years. You can ask
              us about it at admin@realcomply.com.au.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
