"use client";

// Global "ask the Act" chat bubble — mounted once in src/app/dashboard/layout.tsx
// so it's available on every authenticated page (property list, add-property,
// property detail, summary) without needing to be wired into each one
// individually. Talks to src/lib/actions/legislation-chat.ts, which is
// grounded strictly in the Property and Stock Agents Act 2002 (NSW) text —
// see that file's header comment for what it does and doesn't cover.
//
// Kept deliberately simple: no persistence between page loads or across
// devices. It's a quick-lookup aid used mid-task, not a saved record — if the
// answer matters, the agent copies it into the item's note themselves, same
// as any other diligence-support output in this app.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { askLegislationQuestion, type ChatMessage } from "@/lib/actions/legislation-chat";

export function LegislationChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending) return;

    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setError(null);
    setPending(true);

    const result = await askLegislationQuestion(next);
    setPending(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.reply) {
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply! }]);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-rc-border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-rc-border bg-rc-green-deep px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Ask the Act</p>
              <p className="text-[11px] text-white/80">NSW property &amp; real estate legislation</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-white/80 transition hover:text-white"
            >
              ✕
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="text-sm text-neutral-500">
                Ask a question about the Act — e.g. &ldquo;when does cooling-off apply?&rdquo; or &ldquo;what does
                s49 say about agent&apos;s interest?&rdquo; This is diligence support, not legal advice — always
                check the actual section and, if it matters, your adviser.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-rc-green-deep px-3 py-2 text-sm text-white"
                    : "mr-auto max-w-[90%] rounded-lg rounded-bl-sm bg-neutral-100 px-3 py-2 text-sm text-rc-ink whitespace-pre-wrap"
                }
              >
                {m.content}
              </div>
            ))}
            {pending && (
              <div className="mr-auto max-w-[90%] rounded-lg rounded-bl-sm bg-neutral-100 px-3 py-2 text-sm text-neutral-500">
                Checking the Act…
              </div>
            )}
            {error && (
              <p className="rounded-md border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-xs text-rc-amber-deep">
                {error}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2 border-t border-rc-border p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about the Act…"
              disabled={pending}
              className="flex-1 rounded-md border border-rc-border px-3 py-1.5 text-sm focus:border-rc-green-deep focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="rounded-md bg-rc-green-deep px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Ask
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close legislation chat" : "Ask the Act"}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-rc-green-deep text-white shadow-lg transition hover:opacity-90"
      >
        {open ? (
          <span className="text-xl leading-none">✕</span>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8-1.135 0-2.222-.187-3.222-.53L3 21l1.657-3.976C3.61 15.847 3 14.482 3 13c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        )}
      </button>
    </>
  );
}
