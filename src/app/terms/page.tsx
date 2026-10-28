import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { PublicAnalytics } from "@/components/PublicAnalytics";
import { legalDocument } from "@/lib/legal/documents";

const doc = legalDocument("terms");

export const metadata: Metadata = {
  title: `${doc.title} · RealComply`,
  description: "The terms on which RealComply is provided to real estate agencies in New South Wales.",
};

// Public page, so it is counted by Vercel Web Analytics (PublicAnalytics.tsx).
export default function TermsPage() {
  return (
    <>
      <LegalPage doc={doc} />
      <PublicAnalytics />
    </>
  );
}
