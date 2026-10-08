import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { legalDocument } from "@/lib/legal/documents";

const doc = legalDocument("dpa");

export const metadata: Metadata = {
  title: `${doc.title} · RealComply`,
  description: "How RealComply handles personal information on behalf of the agencies that subscribe to it.",
};

export default function DpaPage() {
  return <LegalPage doc={doc} />;
}
