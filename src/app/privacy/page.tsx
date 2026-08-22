import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalDocument } from "@/lib/legal/documents";

const doc = legalDocument("privacy");

export const metadata: Metadata = {
  title: `${doc.title} · RealComply`,
  description: "What personal information RealComply handles, where it is held, and who else processes it.",
};

export default function PrivacyPage() {
  return <LegalPage doc={doc} />;
}
