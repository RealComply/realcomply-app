import Link from "next/link";
import { Logo } from "@/components/Logo";

// Every address nothing answers, and any "not found" outside the dashboard
// (10 Oct 2026). Next's default 404 follows the device's colour scheme, so on
// a phone in dark mode it came up black, and it had no way back into the app.
// This one is in the app's own light style. The dashboard has its own, inside
// the menu (app/dashboard/not-found.tsx).
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-rc-bg-alt px-4 py-16">
      <div className="w-full max-w-md rounded-card border border-rc-border bg-white p-8 text-center shadow-card">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-rc-ink">Page not found</h1>
        <p className="mt-2 text-sm text-rc-muted">
          There&rsquo;s nothing at this address. It may have been mistyped, or the link may be out of date.
        </p>
        <Link
          href="/dashboard/home"
          className="mt-6 inline-flex rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
        >
          Back to Home
        </Link>
        <p className="mt-4 text-xs text-rc-faint">
          Or go to{" "}
          <Link href="/" className="font-medium text-rc-muted hover:text-rc-green-deep">
            realcomply.com.au
          </Link>
        </p>
      </div>
    </main>
  );
}
