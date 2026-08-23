"use client";

import { useActionState, useState } from "react";
import { saveAgencyLogo } from "@/lib/actions/team";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildAgencyLogoPath, uploadEvidenceObject } from "@/lib/storage/evidence";

// The agency's own logo, drawn at the top of the finalised compliance record.
//
// Adam, 23 Aug 2026: an office subscription adds their logo; an individual
// agent gets the office name and their own name with no logo. So the absence of
// a logo is a supported state, not a missing setting — the copy below says that
// plainly rather than nagging.
//
// Licensee-only, and rendered only for them (see the Team page). The logo is
// what the agency's compliance record is signed with in the eyes of whoever
// reads it, so an agent should not be able to change it.

const initial = { error: null as string | null, saved: false };

// PNG and JPEG only, because those are the two pdf-lib can embed. Refused here
// rather than at export time, where the agent would discover it while trying to
// hand a document to Fair Trading. SVG is the one people reach for and the one
// that cannot work.
const ACCEPTED = /\.(png|jpe?g)$/i;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function AgencyLogoForm({
  currentPath,
  currentUrl,
}: {
  currentPath: string | null;
  /**
   * A signed URL for the saved logo, created on the server. Passed in rather
   * than fetched here: the bucket is private, the page is already a server
   * component with a client, and doing it there means this component needs no
   * effect and no loading state.
   */
  currentUrl: string | null;
}) {
  const [state, action, pending] = useActionState(saveAgencyLogo, initial);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [path, setPath] = useState(currentPath ?? "");
  // What is on screen: the saved logo, or a local preview of one just chosen
  // but not yet saved. Set from an event handler, never an effect.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const preview = localPreview ?? (path === currentPath ? currentUrl : null);

  async function handleChoose(chosen: File | null) {
    setClientError(null);
    setFile(chosen);
    if (!chosen) {
      setLocalPreview(null);
      return;
    }

    if (!ACCEPTED.test(chosen.name)) {
      setClientError("The logo has to be a PNG or JPG. An SVG won't work on the PDF.");
      setFile(null);
      return;
    }
    if (chosen.size > MAX_LOGO_BYTES) {
      setClientError("That file is over 2 MB. A logo only needs to be a few hundred kilobytes.");
      setFile(null);
      return;
    }

    // Uploaded on choose rather than on submit, because unlike a compliance
    // document there is nothing to lose here: the path is not recorded until
    // the form is saved, and an orphaned object costs nothing.
    setUploading(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("agency_id").eq("id", user.id).maybeSingle()
      : { data: null };

    if (!profile?.agency_id) {
      setClientError("Couldn't confirm your agency — try reloading the page.");
      setUploading(false);
      return;
    }

    const target = buildAgencyLogoPath(profile.agency_id, chosen.name);
    const { error } = await uploadEvidenceObject(supabase, { path: target, file: chosen });
    setUploading(false);
    if (error) {
      setClientError(error);
      return;
    }
    setPath(target);
    setLocalPreview(URL.createObjectURL(chosen));
  }

  return (
    <form action={action} className="mt-2 rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-sm font-medium text-rc-ink">Agency logo</p>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">
        Drawn at the top of the finalised compliance record, above your office name. PNG or JPG.
        Leave it empty and the record shows your office name and the agent&rsquo;s name instead, which is
        what an individual agent wants.
      </p>

      <input type="hidden" name="logoPath" value={path} />

      {preview && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-rc-border bg-rc-bg-alt p-3">
          {/* Deliberately a plain img: the source is a short-lived signed URL to
              a private bucket, which next/image cannot optimise and would only
              proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your agency logo" className="max-h-12 max-w-[180px] object-contain" />
          <button
            type="button"
            onClick={() => {
              setPath("");
              setFile(null);
              setLocalPreview(null);
            }}
            className="ml-auto text-xs text-rc-faint transition hover:text-rc-amber-deep hover:underline"
          >
            Remove
          </button>
        </div>
      )}

      <div className="mt-3">
        <FileDropZone
          compact
          file={file}
          onFile={handleChoose}
          disabled={uploading || pending}
          maxBytes={MAX_LOGO_BYTES}
          label={preview ? "Drag a different logo here, or click to browse" : "Drag your logo here, or click to browse"}
        />
      </div>

      <button
        type="submit"
        disabled={pending || uploading}
        className="mt-3 rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {uploading ? "Uploading…" : pending ? "Saving…" : "Save logo"}
      </button>

      {(clientError ?? state.error) && (
        <p className="mt-2 text-sm text-rc-amber-deep" role="alert">
          {clientError ?? state.error}
        </p>
      )}
      {state.saved && !state.error && !clientError && (
        <p className="mt-2 text-sm font-medium text-rc-green-deep" role="status">
          Saved.
        </p>
      )}
    </form>
  );
}
