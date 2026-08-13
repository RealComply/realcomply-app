import { LegislationChat } from "@/components/legislation/LegislationChat";
import { Sidebar } from "@/components/Sidebar";
import { UserBar } from "@/components/UserBar";
import { requireProfile } from "@/lib/data/current-profile";

// Shared across every /dashboard/* page. Now owns the whole application
// shell — sidebar, user bar, page background — rather than only the "Ask the
// Act" bubble.
//
// Previously each page rendered its own <TopNav profile={profile} />, which
// meant ten copies of the same two lines and ten places to edit whenever
// navigation changed. Moving it here makes navigation defined once. The old
// comment justified per-page rendering on the grounds that pages "need
// different profile data" — they don't; they all call requireProfile(), which
// is now wrapped in React's cache() so the layout and the page share a single
// fetch per request rather than doing two.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  return (
    // Column width comes from --rc-sidebar-w, which Sidebar sets on <html>
    // when you collapse or expand it. Declared with a fallback so the first
    // server-rendered paint is correct even before any client code runs.
    <div className="rc-app-shell min-h-screen bg-rc-bg-alt transition-[grid-template-columns] duration-200 md:grid md:grid-cols-[var(--rc-sidebar-w,236px)_1fr]">
      <Sidebar />
      <div className="flex min-h-screen flex-col">
        <UserBar profile={profile} />
        {children}
        <LegislationChat />
      </div>
    </div>
  );
}
