import Link from "next/link";

// What a page under /dashboard shows when there is nothing there for the
// person asking (10 Oct 2026).
//
// Since the agent access change a licensee's page answers "not found" to
// anyone else, the same as an address that does not exist (Adam, 7 Oct
// 2026). That fell through to Next's bare default page: outside the app, no
// menu, no way back, and black on a phone set to dark mode. Every agent's
// Monday digest linked to one of those pages. Here it renders inside the
// dashboard layout, so the menu stays, and it says no more than an address
// that does not exist would.
export default function DashboardNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Page not found</h1>
      <p className="mt-2 max-w-prose text-sm text-rc-muted">
        There&rsquo;s nothing at this address. It may have been mistyped, or the link may be out of date.
      </p>
      <Link
        href="/dashboard/home"
        className="mt-6 inline-flex rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
      >
        Back to Home
      </Link>
    </main>
  );
}
