"use client";

import { useState } from "react";
import { buildStoreZip, type ZipEntry } from "@/lib/zip/store-zip";
import type { Manifest } from "@/lib/subscription-end/records";

// "Download all records": one zip with the audit pack for every listing, the
// registers, training, CPD, licence and trust records as spreadsheets, and
// every uploaded document.
//
// Built in the browser. The server hands over a manifest (what to fetch, by
// short-lived signed link) and the browser fetches each piece and zips it.
// Nothing large passes through a server function with a size or time limit,
// and nothing has to be stored anywhere while it is prepared.
//
// HONEST ABOUT GAPS. The Data Retention Policy names the export as the single
// point of failure: with nothing kept after day 14, a partial download is a
// lost record. So anything that fails to download is listed, by name, in a
// file inside the zip AND on the screen, never quietly left out.

type Phase =
  | { kind: "idle" }
  | { kind: "working"; done: number; total: number }
  | { kind: "ready"; url: string; name: string; missing: string[] }
  | { kind: "error"; message: string };

export function DownloadAll({ agencyName }: { agencyName: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function run() {
    setPhase({ kind: "working", done: 0, total: 0 });
    try {
      const res = await fetch("/dashboard/records/manifest", { cache: "no-store" });
      if (!res.ok) throw new Error("The list of records could not be prepared.");
      const manifest = (await res.json()) as Manifest;

      const encoder = new TextEncoder();
      const entries: ZipEntry[] = manifest.csv.map((c) => ({ path: c.zipPath, bytes: encoder.encode(c.content) }));
      const jobs: Array<{ path: string; url: string }> = [
        ...manifest.listings.map((l) => ({
          path: `${l.folder}/Compliance record (audit pack).pdf`,
          url: `/dashboard/records/listing/${l.id}`,
        })),
        ...manifest.files.map((f) => ({ path: f.zipPath, url: f.url })),
      ];

      const missing: string[] = [];
      let done = 0;
      setPhase({ kind: "working", done, total: jobs.length });

      // A few at a time: fast enough, and gentle on a phone connection.
      const queue = [...jobs];
      async function worker() {
        for (let job = queue.shift(); job; job = queue.shift()) {
          try {
            const r = await fetch(job.url, { cache: "no-store" });
            if (!r.ok) throw new Error(String(r.status));
            entries.push({ path: job.path, bytes: new Uint8Array(await r.arrayBuffer()) });
          } catch {
            missing.push(job.path);
          }
          done += 1;
          setPhase({ kind: "working", done, total: jobs.length });
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);

      if (missing.length > 0) {
        entries.push({
          path: "MISSING FILES - READ THIS.txt",
          bytes: encoder.encode(
            "These files could not be downloaded and are NOT in this zip. Try the download again, " +
              "or email admin@realcomply.com.au before your records are deleted.\r\n\r\n" +
              missing.join("\r\n") +
              "\r\n",
          ),
        });
      }

      entries.sort((a, b) => a.path.localeCompare(b.path));
      const blob = new Blob(buildStoreZip(entries) as BlobPart[], { type: "application/zip" });
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `RealComply records - ${agencyName.replace(/[\\/:*?"<>|]/g, "-")} - ${stamp}.zip`;
      const url = URL.createObjectURL(blob);
      setPhase({ kind: "ready", url, name, missing });

      // Start the download straight away; the link below is there if the
      // browser blocks it.
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong." });
    }
  }

  return (
    <div className="rec-row">
      {phase.kind === "working" ? (
        <>
          <button type="button" className="rec-btn rec-btn-solid" disabled>
            Preparing…
          </button>
          <span className="rec-small" aria-live="polite">
            {phase.total === 0 ? "Listing your records…" : `${phase.done} of ${phase.total} files`}. Keep this page open.
          </span>
        </>
      ) : phase.kind === "ready" ? (
        <>
          <a href={phase.url} download={phase.name} className="rec-btn rec-btn-solid">
            Save the zip again
          </a>
          {phase.missing.length > 0 ? (
            <p role="alert" className="rec-error">
              {phase.missing.length} {phase.missing.length === 1 ? "file" : "files"} could not be downloaded. They are
              listed in &ldquo;MISSING FILES - READ THIS.txt&rdquo; inside the zip. Try again, or email
              admin@realcomply.com.au.
            </p>
          ) : (
            <span className="rec-small" aria-live="polite">
              Done. Check your Downloads folder.
            </span>
          )}
        </>
      ) : (
        <>
          <button type="button" className="rec-btn rec-btn-solid" onClick={run}>
            Download all records
          </button>
          <span className="rec-small">
            {phase.kind === "error"
              ? `${phase.message} Try again, or email admin@realcomply.com.au.`
              : "It may take a few minutes to prepare. Best done on a computer."}
          </span>
        </>
      )}
    </div>
  );
}
