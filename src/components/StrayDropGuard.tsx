"use client";

import { useStrayDropGuard } from "@/lib/use-file-drop";

// Mounted once in the dashboard layout. Renders nothing; exists so a file
// dropped anywhere that is not an upload control does nothing at all, rather
// than replacing the page with the document. See use-file-drop.ts.
export function StrayDropGuard() {
  useStrayDropGuard();
  return null;
}
