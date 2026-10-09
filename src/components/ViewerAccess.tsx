"use client";

import { createContext, useContext } from "react";

// The signed-in person's access (lib/access.ts), for controls deep inside a
// page that would otherwise need it passed down through every card — the
// Remove buttons above all. Set once by the dashboard layout.
//
// Only hides controls. The database rules (0058) are what refuse the action,
// so a control that slipped through would fail, not succeed.
type ViewerAccess = { actsAsLicensee: boolean; officeLicensee: boolean };

const Ctx = createContext<ViewerAccess>({ actsAsLicensee: false, officeLicensee: false });

export function ViewerAccessProvider({ value, children }: { value: ViewerAccess; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewerAccess(): ViewerAccess {
  return useContext(Ctx);
}
