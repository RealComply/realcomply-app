"use client";

// The chat bubble, mounted once in src/app/dashboard/layout.tsx so it is on
// every authenticated page.
//
// TWO ASSISTANTS BEHIND ONE BUTTON (Adam, 16 Aug 2026): "Ask the Act" for the
// legislation, and "I have a question about RealComply" for how to use the
// product. Opening the bubble asks which, rather than guessing from the
// question, because the two are grounded in completely different material and
// a wrong guess produces the most damaging kind of answer — a confident one
// from the wrong source. Picking is one tap and removes the ambiguity
// entirely.
//
// Was src/components/legislation/LegislationChat.tsx. Renamed when the second
// mode landed: a file called LegislationChat containing the product help
// assistant is the kind of thing that misleads whoever reads it next.
//
// Still no persistence, deliberately. It is a quick-lookup aid used mid-task,
// not a saved record — if an answer matters, the agent copies it into the
// item's note themselves, same as every other diligence-support output here.
// Switching modes clears the thread, since a half-finished legislation
// conversation is not context the help assistant should inherit.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, MessageCircleQuestion, Scale, LifeBuoy, ChevronLeft } from "lucide-react";
import { askLegislationQuestion, type ChatMessage } from "@/lib/actions/legislation-chat";
import { askProductQuestion } from "@/lib/actions/help-chat";
import { DictateButton, appendDictated } from "@/components/Dictate";

type Mode = "act" | "help";

const MODES = {
  act: {
    title: "Ask the Act",
    subtitle: "NSW property & real estate legislation",
    placeholder: "Ask about the Act…",
    thinking: "Checking the Act…",
    empty:
      "Ask a question about the Act — e.g. “when does cooling-off apply?” or “what does s49 say about agent’s interest?” This is diligence support, not legal advice — always check the actual section and, if it matters, your adviser.",
    ask: askLegislationQuestion,
  },
  help: {
    title: "Help with RealComply",
    subtitle: "How to use the app",
    placeholder: "Ask about RealComply…",
    thinking: "Looking it up…",
    empty:
      "Ask anything about using RealComply — e.g. “how do I get my licensee to sign off?” or “why can’t I see the pool certificate item?” If I’m not sure, I’ll say so rather than guess.",
    ask: askProductQuestion,
  },
} as const;

export function AssistantChat() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function chooseMode(next: Mode) {
    setMode(next);
    setMessages([]);
    setInput("");
    setError(null);
  }

  function backToMenu() {
    setMode(null);
    setMessages([]);
    setInput("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || pending || !mode) return;

    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setError(null);
    setPending(true);

    const result = await MODES[mode].ask(next);
    setPending(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.reply) {
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply! }]);
    }
  }

  const active = mode ? MODES[mode] : null;

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-rc-border bg-white shadow-card-lg">
          <div className="flex items-center justify-between gap-2 bg-rc-ink-bg px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-2">
              {/* Back is how you switch assistants. Present only once a mode is
                  chosen, so the menu itself has nothing to go back to. */}
              {mode && (
                <button
                  type="button"
                  onClick={backToMenu}
                  aria-label="Back to menu"
                  className="shrink-0 text-rc-ink-muted transition hover:text-white"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{active ? active.title : "How can I help?"}</p>
                <p className="truncate text-[11px] text-rc-ink-muted">
                  {active ? active.subtitle : "Pick what you need"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 text-rc-ink-muted transition hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {!mode ? (
            <div className="flex flex-1 flex-col gap-3 bg-rc-bg-alt px-4 py-5">
              <ModeButton
                icon={<Scale size={18} strokeWidth={2} />}
                title="Ask the Act"
                blurb="What the NSW legislation actually says. Grounded in the Acts and Regulations, with the section quoted."
                onClick={() => chooseMode("act")}
              />
              <ModeButton
                icon={<LifeBuoy size={18} strokeWidth={2} />}
                title="I have a question about RealComply"
                blurb="How to use the app — where things live, what a button does, why an item is or isn’t showing."
                onClick={() => chooseMode("help")}
              />
              <p className="mt-auto text-[11px] leading-relaxed text-rc-muted">
                Both are diligence support, not legal advice. The licensee decides.
              </p>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-rc-bg-alt px-4 py-3">
                {messages.length === 0 && <p className="text-sm text-rc-muted">{active!.empty}</p>}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={
                      m.role === "user"
                        ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-rc-green-deep px-3 py-2 text-sm text-white shadow-sm"
                        : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-rc-ink shadow-sm"
                    }
                  >
                    {m.content}
                  </div>
                ))}
                {pending && (
                  <div className="mr-auto max-w-[90%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm text-rc-muted shadow-sm">
                    {active!.thinking}
                  </div>
                )}
                {error && (
                  <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-xs text-rc-amber-deep">
                    {error}
                  </p>
                )}
              </div>

              <form onSubmit={handleSubmit} className="border-t border-rc-border bg-white p-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={active!.placeholder}
                    disabled={pending}
                    className="flex-1 rounded-full border border-rc-border px-3.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={pending || !input.trim()}
                    className="rounded-full bg-rc-green-deep px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
                  >
                    Ask
                  </button>
                </div>
                {/* This input is controlled, so dictation appends through
                    setInput rather than writing to the element. It fills the
                    box and stops there — asking is still a deliberate press of
                    Ask, because a question sent on a mis-transcription wastes a
                    call and reads as the app acting on its own. */}
                <span className="mt-2 block">
                  <DictateButton
                    label="Speak your question"
                    onText={(t) => setInput((prev) => appendDictated(prev, t))}
                  />
                </span>
              </form>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-rc-green-deep text-white shadow-card-lg transition hover:bg-rc-green-deep-600"
      >
        {open ? <X size={22} /> : <MessageCircleQuestion size={24} />}
      </button>
    </>
  );
}

function ModeButton({
  icon,
  title,
  blurb,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-card border border-rc-border bg-white p-3.5 text-left shadow-card transition hover:border-rc-green-deep/40"
    >
      <span className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-rc-green-deep"
          style={{ background: "var(--rc-badge-grad-green)" }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span>
          <span className="block text-sm font-semibold text-rc-ink">{title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-rc-muted">{blurb}</span>
        </span>
      </span>
    </button>
  );
}
