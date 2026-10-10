import Link from "next/link";
import { requireProfile } from "@/lib/data/current-profile";

// Getting started: the walkthrough video and the two steps to a first file.
//
// Adam, 10 Oct 2026: the demo videos sit inside RealComply, on a page you only
// see once signed in, so a forwarded email doesn't hand a competitor a full
// walkthrough. The early access welcome email links here. Mockup approved the
// same day.
//
// Any signed-in role. The dashboard layout does the signing-in check; the
// requireProfile here is the page's own, so it never renders for nobody.

export const metadata = { title: "Getting started · RealComply" };

type Video = { id: string; title: string; length: string };

// The agent video joins this list once it's rebuilt (brief, 10 Oct 2026).
// Each entry renders as its own player with its caption underneath.
const VIDEOS: Video[] = [{ id: "xzAW28t758g", title: "RealComply for licensees", length: "3 min 40" }];

export default async function GettingStartedPage() {
  await requireProfile();

  return (
    <main className="mx-auto w-full max-w-[880px] flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Getting started</h1>
      <p className="mt-1.5 max-w-[60ch] text-base text-rc-muted">
        A short tour of RealComply on a made-up listing, then the two steps to get your first file going.
      </p>

      <div className="mt-6 space-y-6">
        {VIDEOS.map((v) => (
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

        <section className="rounded-[18px] border border-rc-border bg-white p-6 shadow-card">
          <h2 className="text-lg font-bold text-rc-ink">Then, your first listing</h2>
          <ol className="mt-4 space-y-4">
            <li className="flex items-start gap-3.5">
              <span className="flex h-[26px] min-w-[34px] items-center justify-center rounded-full bg-rc-green-soft text-sm font-extrabold text-rc-green-deep">
                1
              </span>
              <div>
                <p className="font-bold text-rc-ink">Start a listing you&rsquo;re working on now</p>
                <p className="mt-0.5 max-w-[62ch] text-rc-muted">
                  Click New listing at the top of any page and answer a few quick questions.
                </p>
                <Link
                  href="/dashboard/new"
                  className="mt-2.5 inline-block rounded-full bg-rc-green-deep px-[18px] py-2 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
                >
                  New listing
                </Link>
              </div>
            </li>
            <li className="flex items-start gap-3.5">
              <span className="flex h-[26px] min-w-[34px] items-center justify-center rounded-full bg-rc-green-soft text-sm font-extrabold text-rc-green-deep">
                2
              </span>
              <div>
                <p className="font-bold text-rc-ink">Drop in your documents</p>
                <p className="mt-0.5 max-w-[62ch] text-rc-muted">
                  Add the agency agreement, contract and comparables. RealComply reads them and fills in what it can
                  for you to check.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <p className="text-sm text-rc-muted">Stuck on something? Reply to any email from us. We read every one.</p>
      </div>
    </main>
  );
}
