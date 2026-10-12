"use client";

import { useSearchParams } from "next/navigation";

// Shown on return from Stripe after reactivating. The webhook that lifts the
// records page usually lands a second or two after the person does, so for a
// moment the page still says the subscription has ended. Said plainly here
// rather than leaving them to wonder whether it worked.
export function ReactivatedNotice() {
  const params = useSearchParams();
  if (params.get("reactivated") !== "1") return null;
  return (
    <div className="rec-box" role="status">
      <p style={{ margin: 0 }}>
        Thanks. Stripe is confirming your payment, and this page returns to normal within a minute.{" "}
        {/* A full page load on purpose: the dashboard has to read the
            subscription again, which a <Link> navigation would not do. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/dashboard/home">Refresh</a>
      </p>
    </div>
  );
}
