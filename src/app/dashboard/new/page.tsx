import { requireProfile } from "@/lib/data/current-profile";
import { NewPropertyForm } from "@/components/property/NewPropertyForm";

// Server component so the browser has the agency_id it needs to upload
// setup documents straight to Storage (see NewPropertyForm.tsx) without an
// extra client-side round trip before the form is usable.
export default async function NewPropertyPage() {
  const profile = await requireProfile();
  return (
    <>
      <NewPropertyForm agencyId={profile.agency_id} />
    </>
  );
}
