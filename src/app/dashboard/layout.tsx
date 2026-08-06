import { LegislationChat } from "@/components/legislation/LegislationChat";

// Shared across every /dashboard/* page (property list, add-property,
// property detail, summary) — the one place to mount things that should
// appear everywhere an agent actually works, without wiring each page
// individually. Currently just the "Ask the Act" chat bubble; each page
// keeps rendering its own TopNav since they need different profile data.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LegislationChat />
    </>
  );
}
