import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { LicenseeConfirmView, type LicenseeConfirmDetails } from "@/components/licensee-email/LicenseeConfirmView";

// The page the confirm email opens (0112; Master, 4 Nov 2026). Opened by
// whoever has the licensee email, with no RealComply login, so no navigation
// and one button. It says only "Confirm you're the licensee in charge at
// [office]": nothing from the office's records. The token is the only
// credential; the page reads through licensee_confirmation_details() and
// writes through confirm_licensee_email(), nothing else.

export const metadata: Metadata = {
  title: "Confirm you're the licensee in charge",
  // Never index. The token is the credential, and a crawled URL is a published one.
  robots: { index: false, follow: false },
};

export default async function LicenseeConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = /^[0-9a-f-]{36}$/i.test(token)
    ? await supabase.rpc("licensee_confirmation_details", { p_token: token })
    : { data: null, error: null };
  const details = !error && Array.isArray(data) ? ((data[0] ?? null) as LicenseeConfirmDetails | null) : null;
  return <LicenseeConfirmView token={token} details={details} />;
}
