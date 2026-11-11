import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/data/current-profile";
import { createClient } from "@/lib/supabase/server";
import { sgAmendmentsFor, sgChangeLogFor, sgDocumentsFor, sgReviewDueFor } from "@/lib/data/sg-document";
import { todayInSydney } from "@/lib/sg-document/amendments";
import { sgPdfFileName, sgPdfInput } from "@/lib/sg-document/export";
import { buildSgDocumentPdf } from "@/lib/pdf/sg-document";

// Export PDF (Adam's mockup, screens 2 and 5; Master, 10 Nov 2026; part 4b):
// the office's live supervision guidelines with every approved amendment
// merged in, then the change log at the back. Whoever runs the office: they
// read every signature, so "Staff signed" is the office's real count. Read
// with their own access; built fresh each time, never stored.

export const dynamic = "force-dynamic";

export async function GET() {
  const { profile, access } = await requireAccess();
  if (!access.runsOffice) notFound();
  const supabase = await createClient();
  const sg = await sgDocumentsFor(supabase);
  if (!sg.live) notFound();
  const live = sg.live;

  const [amendments, review, changeLog, { data: agency }] = await Promise.all([
    sgAmendmentsFor(supabase, live.doc.id),
    sgReviewDueFor(supabase, profile.agency_id),
    sgChangeLogFor(supabase, profile.agency_id),
    supabase.from("agencies").select("name").eq("id", profile.agency_id).maybeSingle(),
  ]);

  const input = sgPdfInput({
    officeName: (agency as { name?: string } | null)?.name ?? "",
    docType: live.doc.docType,
    versionLabel: live.doc.versionLabel,
    savedAt: live.doc.savedAt,
    savedByName: live.doc.savedByName,
    sections: live.sections,
    amendments,
    nextReviewDue: review?.dueOn ?? null,
    exportedBy: (profile.full_name ?? "").trim() || profile.email || "a team member",
    today: todayInSydney(),
    changeLog,
  });
  const bytes = await buildSgDocumentPdf(input);
  const response = new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${sgPdfFileName(input).replace(/"/g, "")}"`,
    },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
