import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PublicAnalytics } from "@/components/PublicAnalytics";
import { legalDocument } from "@/lib/legal/documents";

const doc = legalDocument("privacy");

export const metadata: Metadata = {
  title: `${doc.title} · RealComply`,
  description: "What personal information RealComply handles, where it is held, and who else processes it.",
};

// Public page, so it is counted by Vercel Web Analytics (PublicAnalytics.tsx).
export default function PrivacyPage() {
  return (
    <>
      <LegalPage doc={doc} />
      <PublicAnalytics />
    </>
  );
}
