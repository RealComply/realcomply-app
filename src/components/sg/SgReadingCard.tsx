"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { continueSgDocumentRead } from "@/lib/actions/sg-document";

// While the document is being read: how far it's got, and the reading kept
// moving for as long as the page is open. Leave the page and the hourly job
// carries on from the same place; nothing is read twice.
export function SgReadingCard({
  id,
  fileName,
  done: firstDone,
  total: firstTotal,
  fromFileOnRecord,
}: {
  id: string;
  fileName: string;
  done: number;
  total: number | null;
  fromFileOnRecord: boolean;
}) {
  const router = useRouter();
  const [progress, setProgress] = useState({ done: firstDone, total: firstTotal });
  const [problem, setProblem] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = async () => {
      if (stopped.current) return;
      try {
        const p = await continueSgDocumentRead(id);
        if (stopped.current) return;
        if ("error" in p) {
          setProblem(p.error);
          return;
        }
        setProblem(null);
        setProgress({ done: p.done, total: p.total });
        if (p.status === "draft" || p.status === "read_failed") {
          router.refresh();
          return;
        }
        // Someone else is reading it (another tab, the hourly job), or the
        // reader was busy: ask again shortly.
        timer = setTimeout(step, p.status === "elsewhere" ? 8000 : 4000);
      } catch {
        if (!stopped.current) timer = setTimeout(step, 10000);
      }
    };
    void step();
    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, router]);

  const { done, total } = progress;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <section className="rounded-card border border-rc-border bg-white p-5 shadow-card" aria-live="polite">
      <h2 className="text-base font-semibold text-rc-ink">Reading your document</h2>
      <p className="mt-1 text-sm text-rc-muted">
        {fromFileOnRecord ? "Your manual on file, " : ""}
        <span className="font-medium text-rc-ink">{fileName}</span>
        {fromFileOnRecord ? "," : ""} is being read into sections.{" "}
        {total ? `Part ${Math.min(done + 1, total)} of ${total}.` : "Starting."}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-rc-bg-alt" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-rc-green-deep transition-all" style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      <p className="mt-2 text-xs text-rc-muted">
        A long document takes a few minutes. You can leave this page: it carries on reading, and Home tells you when it&rsquo;s
        ready to check.
      </p>
      {problem && <p className="mt-2 text-xs text-rc-amber-deep">{problem}</p>}
    </section>
  );
}
