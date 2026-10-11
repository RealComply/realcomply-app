"use client";

import { useEffect, useRef } from "react";

// Runs `onSaved` once a form's server action has come back without an error.
//
// The register forms used to close themselves with
// `action={async fd => { await formAction(fd); setAdding(false) }}`. The
// dispatch useActionState hands back returns nothing, so that await waited one
// tick, not for the server: the form closed while the save was still in
// flight, and when a refusal came back its message rendered inside a form that
// was no longer there (check of 10 Oct 2026). A gift worth $1,000,000,000
// simply vanished.
//
// Same detection as StageActions: watch pending fall from true to false, and
// only count it as saved when there is no error. A refusal leaves the form
// open with its message under the Save button.
export function useOnSaved(pending: boolean, error: string | null, onSaved: () => void): void {
  const wasPending = useRef(false);
  const saved = useRef(onSaved);
  useEffect(() => {
    saved.current = onSaved;
  });
  useEffect(() => {
    if (wasPending.current && !pending && !error) saved.current();
    wasPending.current = pending;
  }, [pending, error]);
}
