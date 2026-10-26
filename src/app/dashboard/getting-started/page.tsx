import Link from "next/link";
import type { ReactNode } from "react";
import { SignedAnnexureUpload } from "@/components/annexure/SignedAnnexureUpload";
import { openAnnexureSigning } from "@/lib/actions/sg-annexure";
import { DOWNLOAD_LABEL, UPLOAD_HINT } from "@/lib/agent-acknowledgement";
import { requireAccess } from "@/lib/data/current-profile";
import { videosFor } from "@/lib/onboarding/videos";
import { createClient } from "@/lib/supabase/server";

// Getting started: the walkthrough video and the two steps to a first file.
//
// Adam, 10 Oct 2026: the demo videos sit inside RealComply, on a page you only
// see once signed in, so a forwarded email doesn't hand a competitor a full
// walkthrough. The early access welcome email links here. Mockup approved the
// same day.
//
// Any signed-in role. The dashboard layout does the signing-in check; the
// requireAccess here is the page's own, so it never renders for nobody.
//
// Agents see the agent video, licensees see both (lib/onboarding/videos.ts).
//
// CHANGE (Adam, trial brief 23 Oct 2026; mockup "Getting started after
// sign-up"). WAS: two steps for everyone (start a listing, drop in your
// documents). NOW, for whoever acts as the licensee: 1 Upload your licence,
// 2 Add your first listing and upload its agency agreement, 3 Adopt the
// annexure ("Needed before your second listing": the first listing no longer
// waits for it, 0087), 4 Invite your agents. A single agent on their own plan
// has no agents to invite, so they see the first three; for them step 3 is
// the signed annexure (download, sign, upload). Agents and assistants in an
// office keep the two listing steps: the other three are the licensee's.

const STEP_BADGE =
  "flex h-[26px] min-w-[34px] items-center justify-center rounded-full bg-rc-green-soft text-sm font-extrabold text-rc-green-deep";
const BUTTON_BASE =
  "inline-block rounded-full bg-rc-green-deep px-[18px] py-2 text-sm font-bold text-white transition hover:bg-rc-green-deep-600";
const BUTTON = `mt-2.5 ${BUTTON_BASE}`;

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3.5">
      <span className={STEP_BADGE}>{n}</span>
      <div className="min-w-0">
        <p className="font-bold text-rc-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}

function StepText({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 max-w-[62ch] text-rc-muted">{children}</p>;
}

export const metadata = { title: "Getting started · RealComply" };

export default async function GettingStartedPage() {
  const { profile, access } = await requireAccess();
  const videos = videosFor(access);

  // The office's own annexure link, for an agent on their own plan (as on
  // Home, AgentAnnexureCard).
  let downloadHref = "/annexure/download";
  if (access.isAgentPlan && access.actsAsLicensee) {
    const supabase = await createClient();
    const { data: tokenRow } = await supabase
      .from("agencies")
      .select("annexure_download_token")
      .eq("id", profile.agency_id)
      .maybeSingle();
    const token = (tokenRow as { annexure_download_token?: string | null } | null)?.annexure_download_token;
    if (token) downloadHref = `/annexure/download/${encodeURIComponent(token)}`;
  }

  return (
    <main className="mx-auto w-full max-w-[880px] flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Getting started</h1>
      <p className="mt-1.5 max-w-[60ch] text-base text-rc-muted">
        A short tour of RealComply on a made-up listing, then the steps to get you going.
      </p>

      <div className="mt-6 space-y-6">
        {videos.map((v) => (
          <figure key={v.id}>
            <div className="aspect-video w-full overflow-hidden rounded-[18px] border border-rc-border bg-[#0f1d19]">
              {/* youtube-nocookie: no YouTube cookies until the video is
                  played. loading="lazy": nothing is fetched from YouTube
                  until the player is near the screen. */}
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${v.id}?rel=0`}
                title={v.title}
                loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="h-full w-full border-0"
              />
            </div>
            <figcaption className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-lg font-bold text-rc-ink">{v.title}</span>
              <span className="text-sm tabular-nums text-rc-muted">{v.length}</span>
            </figcaption>
          </figure>
        ))}

        {access.actsAsLicensee ? (
          <section className="rounded-[18px] border border-rc-border bg-white p-6 shadow-card">
            <h2 className="text-lg font-bold text-rc-ink">Then, get set up</h2>
            <ol className="mt-4 space-y-4">
              <Step n={1} title="Upload your licence">
                <StepText>We read the details for you.</StepText>
                <Link href="/dashboard/registers?tab=licence" className={BUTTON}>
                  Upload licence
                </Link>
              </Step>
              <Step n={2} title="Add your first listing and upload its agency agreement">
                <StepText>Watch RealComply read the agreement and fill in the file for you.</StepText>
                <Link href="/dashboard/new" className={BUTTON}>
                  Add listing
                </Link>
              </Step>
              <Step n={3} title="Adopt the annexure to your Supervision Guidelines">
                {access.isAgentPlan ? (
                  <>
                    <StepText>
                      Give it to your licensee in charge to complete and sign the section headed &ldquo;Adoption by the
                      licensee in charge&rdquo;, then upload it. Needed before your second listing.
                    </StepText>
                    <div className="mt-2.5 flex flex-wrap items-start gap-2.5">
                      <a href={downloadHref} className={BUTTON_BASE}>
                        {DOWNLOAD_LABEL}
                      </a>
                      <SignedAnnexureUpload agencyId={profile.agency_id} variant="ghost" />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-rc-faint">{UPLOAD_HINT}</p>
                  </>
                ) : (
                  <>
                    <StepText>
                      Two minutes. It records how RealComply fits your supervision system. Needed before your second
                      listing.
                    </StepText>
                    {access.officeLicensee && (
                      <form action={openAnnexureSigning}>
                        <button type="submit" className={BUTTON}>
                          Review and sign
                        </button>
                      </form>
                    )}
                  </>
                )}
              </Step>
              {!access.isAgentPlan && (
                <Step n={4} title="Invite your agents">
                  <StepText>Each agent sees their own listings. You see the whole office.</StepText>
                  <Link href="/dashboard/team" className={BUTTON}>
                    Invite agents
                  </Link>
                </Step>
              )}
            </ol>
          </section>
        ) : (
          <section className="rounded-[18px] border border-rc-border bg-white p-6 shadow-card">
            <h2 className="text-lg font-bold text-rc-ink">Then, your first listing</h2>
            <ol className="mt-4 space-y-4">
              <Step n={1} title="Start a listing you’re working on now">
                <StepText>Click New listing at the top of any page and answer a few quick questions.</StepText>
                <Link href="/dashboard/new" className={BUTTON}>
                  New listing
                </Link>
              </Step>
              <Step n={2} title="Drop in your documents">
                <StepText>
                  Add the agency agreement, contract and comparables. RealComply reads them and fills in what it can
                  for you to check.
                </StepText>
              </Step>
            </ol>
          </section>
        )}

        <p className="text-sm text-rc-muted">Stuck on something? Reply to any email from us. We read every one.</p>
      </div>
    </main>
  );
}
