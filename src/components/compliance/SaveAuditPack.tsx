"use client";

import { useState } from "react";

// Save as PDF: the audit pack, with every document on the listing inside it
// (Adam, 2 Nov 2026). One button. While the server builds the pack it says so
// ("Preparing your audit pack"); then the browser downloads the finished file
// from the private holding area (lib/pdf/audit-pack-store.ts). Was a plain
// link to the PDF (23 Aug 2026), which showed nothing while a pack was built.
export function SaveAuditPack({ propertyId, className }: { propertyId: string; className: string }) {
  const [state, setState] = useState<"idle" | "preparing" | "error">("idle");

  async function save() {
    setState("preparing");
    try {
      const res = await fetch(`/dashboard/${propertyId}/summary/pdf?prepare=1`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url: string };
      window.location.assign(url);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={save} disabled={state === "preparing"} className={className} aria-live="polite">
        {state === "preparing" ? "Preparing your audit pack…" : "Save as PDF"}
      </button>
      {state === "error" && (
        <span role="alert" className="text-xs text-rc-amber-deep">
          The audit pack couldn&rsquo;t be prepared just now. Try again.
        </span>
      )}
    </span>
  );
}
