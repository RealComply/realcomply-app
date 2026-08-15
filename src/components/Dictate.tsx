"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

// Dictation into any text field. Adam, 15 Aug 2026: typing a paragraph of ESP
// reasoning is the chore that stops it getting written, so let the agent talk
// instead.
//
// EVERYTHING ENGINE-SPECIFIC IS IN THIS FILE, and that is the point. The browser's
// own speech recognition is free and instant to build, but on Chrome the audio is
// sent to Google to be transcribed, which makes them a processor of client
// conversations, and it is absent from Firefox entirely. Adam's call was to start
// free and swap if accuracy disappoints. So useDictation exposes a deliberately
// plain contract — supported / listening / start / stop / error, plus text handed
// back through a callback — and a future version that records audio and posts it
// to a transcription API can replace the internals here without a single button
// changing.
//
// TRANSCRIPT NEVER SAVES ITSELF. It lands in the field for the agent to read and
// correct. The ESP reasoning box is the evidence of how the estimate was formed
// under s72A(5); a misheard figure committed straight to a compliance record is
// worse than no dictation at all. Same reason nothing here submits a form.

// Minimal shape of the browser API. Declared locally rather than pulling in a
// types package for one feature, and kept to only what is used.
type SpeechRecognitionAlternativeLike = { transcript: string };
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
};
type SpeechRecognitionErrorEventLike = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Plain-English failures. The agent gets told what to do about it, not the
// error code the browser handed us.
function messageFor(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow it for this site in your browser settings, then try again.";
    case "audio-capture":
      return "No microphone found. Check one is connected and selected.";
    case "network":
      return "Couldn't reach the speech service. Check your connection and try again.";
    case "no-speech":
      return "Didn't catch anything. Try again, a bit closer to the microphone.";
    case "aborted":
      return "";
    default:
      return "Dictation stopped unexpectedly. Try again, or type it instead.";
  }
}

// Module-level so its identity is stable across renders; an inline arrow would
// make useSyncExternalStore resubscribe every time.
const NEVER_CHANGES = () => () => {};

export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Held in a ref so the recogniser's handlers always reach the latest callback
  // without being rebound every render. Assigned in an effect rather than
  // during render, which React forbids.
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  // Whether this browser can do speech recognition at all. Read through
  // useSyncExternalStore rather than state-in-an-effect: the server has no
  // window, so it reports false there and the real answer on the client, which
  // is exactly the hydration-safe shape this needs. The subscribe function is a
  // no-op because a browser does not gain the API mid-session.
  const supported = useSyncExternalStore(
    NEVER_CHANGES,
    () => getCtor() !== null,
    () => false,
  );

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;

    setError(null);
    const rec = new Ctor();
    // en-AU matters more than it looks: suburb names, street names and the way
    // figures get spoken all recognise better against Australian English.
    rec.lang = "en-AU";
    rec.continuous = true;
    rec.interimResults = false;

    rec.onresult = (e) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      if (finalText.trim()) onTextRef.current(finalText);
    };
    rec.onerror = (e) => {
      const msg = messageFor(e.error);
      if (msg) setError(msg);
      setListening(false);
    };
    rec.onend = () => setListening(false);

    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if called while already running. Nothing to report.
    }
  }, []);

  // Never leave the microphone open on a component that has gone away.
  useEffect(() => {
    return () => {
      recRef.current?.abort();
    };
  }, []);

  return { supported, listening, start, stop, error };
}

/**
 * Microphone button for a text field.
 *
 * Renders nothing at all where the browser has no speech recognition (Firefox,
 * and anything older). A button that cannot work is worse than no button: it
 * invites a click and then explains itself, which reads as the app being broken
 * rather than the browser lacking a feature.
 */
export function DictateButton({
  onText,
  label = "Dictate",
  className = "",
}: {
  onText: (text: string) => void;
  label?: string;
  className?: string;
}) {
  const { supported, listening, start, stop, error } = useDictation(onText);

  if (!supported) return null;

  return (
    <span className={`inline-flex flex-col items-start ${className}`}>
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        aria-label={listening ? "Stop dictating" : label}
        title={listening ? "Stop dictating" : label}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
          listening
            ? "bg-rc-red text-white hover:bg-rc-red/90"
            : "border border-rc-border bg-white text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink"
        }`}
      >
        {listening ? (
          <>
            <Square size={11} className="shrink-0 fill-current" aria-hidden="true" />
            Stop
          </>
        ) : (
          <>
            <Mic size={12} className="shrink-0" aria-hidden="true" />
            {label}
          </>
        )}
      </button>
      {listening && (
        <span className="mt-1 text-[11px] font-medium text-rc-muted" role="status">
          Listening — speak, then press Stop. Check the text before you save.
        </span>
      )}
      {error && (
        <span className="mt-1 text-[11px] font-medium text-rc-amber-deep" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** Appends dictated text to existing text, without gluing words together. */
export function appendDictated(existing: string, addition: string): string {
  const add = addition.trim();
  if (!add) return existing;
  if (!existing.trim()) return add.charAt(0).toUpperCase() + add.slice(1);
  return /[\s]$/.test(existing) ? existing + add : `${existing} ${add}`;
}

/**
 * A textarea with a dictate button beside it.
 *
 * Deliberately leaves the textarea uncontrolled. Every note field in the app is
 * an uncontrolled input inside a server-action form, and converting them to
 * React state purely to support dictation would be a large change to forms that
 * currently work, for no benefit to the typing path. Instead the dictated text
 * is written to the element and an input event dispatched, so anything watching
 * still sees it, and the form submits exactly as before.
 */
export function DictatableTextarea({
  dictateLabel = "Dictate",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { dictateLabel?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const append = useCallback((text: string) => {
    const el = ref.current;
    if (!el) return;
    el.value = appendDictated(el.value, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    // Keep the caret at the end so continuing to type carries on from the
    // dictated text rather than jumping to the start.
    el.selectionStart = el.selectionEnd = el.value.length;
  }, []);

  return (
    <>
      <textarea ref={ref} {...props} />
      <span className="mt-1 block">
        <DictateButton onText={append} label={dictateLabel} />
      </span>
    </>
  );
}
