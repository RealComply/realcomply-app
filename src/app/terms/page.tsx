import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalDocument } from "@/lib/legal/documents";

const doc = legalDocument("terms");

export const metadata: Metadata = {
  title: `${doc.title} · RealComply`,
  description: "The terms on which RealComply is provided to real estate agencies in New South Wales.",
};

export default function TermsPage() {
  return <LegalPage doc={doc} />;
}
