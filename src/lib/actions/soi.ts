"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET, isInFolder, storedFileProblem } from "@/lib/storage/evidence";
import { comparablesFor } from "@/lib/data/comparables";
import { espRevisionsFor } from "@/lib/data/esp-revisions";
import { draftFor, soiVersionsFor } from "@/lib/data/soi";
import { revisionsOrCard } from "@/lib/esp-history";
import { areaOf } from "@/lib/rules/council-area";
import { addressKey } from "@/lib/rules/revision-comparables";
import { SOI_BAD, SOI_NOT_YET, soiApplies, soiContentFrom } from "@/lib/rules/soi";
import { buildSoiPdf, soiFilename } from "@/lib/pdf/soi";
import type { Property, PropertyItem } from "@/lib/types";

// The Statement of Information card (s72C; Reg s12H, s12I; 0121): make one
// from the file, record one made elsewhere, and switch the link for online
// ads on or off. The database numbers each version, stamps who and when,
// keeps them unchanged, and refuses one on a signed-off, withdrawn or ended
// listing; these say so in plain words.

export type SoiActionState = { error: string | null; done?: boolean };

const RELOAD = "This listing's ESP or comparable sales changed while the form was open. Reload the page to make the statement from them.";
const SAVE_FAILED = "Couldn't save the statement just now. Try again.";

const sydneyToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** The database's own refusals are already in plain words; anything else isn't shown. */
const plainError = (error: { code?: string; message?: string } | null): string =>
  error?.code === "P0001" && error.message ? error.message : SAVE_FAILED;

type Ctx = Awaited<ReturnType<typeof requireAuthContext>>;

async function listingFor(ctx: Ctx, propertyId: string) {
  const { supabase } = ctx;
  const [{ data: property }, { data: items }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, agency_id, address, property_type, council_area, stage")
      .eq("id", propertyId)
      .maybeSingle(),
    supabase.from("property_items").select("*").eq("property_id", propertyId),
  ]);
  if (!property) return null;
  const allItems = Object.fromEntries(((items ?? []) as PropertyItem[]).map((i) => [i.item_key, i]));
  return { property: property as Pick<Property, "id" | "agency_id" | "address" | "property_type" | "council_area" | "stage">, allItems };
}

/** The card counts as done once there's a version (Listing set-up). */
async function markCardDone(ctx: Ctx, propertyId: string, versions: number) {
  await ctx.supabase.from("property_items").upsert(
    {
      agency_id: ctx.profile.agency_id,
      property_id: propertyId,
      item_key: "soi",
      status: "done",
      data: { versions },
      event_date: null,
      completed_by: ctx.user.id,
    },
    { onConflict: "property_id,item_key" },
  );
}

/** "Ana Agent, Harbour Realty": who the statement says prepared it. */
async function preparedByFor(ctx: Ctx): Promise<string> {
  const { data: agency } = await ctx.supabase.from("agencies").select("name").eq("id", ctx.profile.agency_id).maybeSingle();
  const person = (ctx.profile.full_name ?? "").trim() || ctx.profile.email;
  const office = ((agency as { name?: string | null } | null)?.name ?? "").trim();
  return office ? `${person}, ${office}` : person;
}

/** Make it in RealComply: the form as checked, onto the approved form, kept as the next version. */
export async function makeStatementOfInformation(propertyId: string, _prev: SoiActionState, formData: FormData): Promise<SoiActionState> {
  const ctx = await requireAuthContext();
  const { supabase, profile } = ctx;
  const listing = await listingFor(ctx, propertyId);
  if (!listing) return { error: SOI_BAD };
  const { property, allItems } = listing;

  const [versions, comparables, stored] = await Promise.all([
    soiVersionsFor(supabase, propertyId),
    comparablesFor(supabase, propertyId),
    espRevisionsFor(supabase, profile.agency_id, propertyId),
  ]);
  if (!soiApplies(allItems["a3"]?.event_date ?? null)) return { error: SOI_NOT_YET };

  // Made from the file as it is now. The form's properties are the ones the
  // file says (their addresses can't be retyped), for the ESP it says.
  const draft = draftFor({ property, allItems, listing: comparables, revisions: revisionsOrCard(stored, allItems["d3"]), versions });
  let sent: Array<{ address?: unknown }> = [];
  try {
    const raw = JSON.parse(String(formData.get("comparables") ?? "[]"));
    sent = Array.isArray(raw) ? raw : [];
  } catch {
    return { error: SOI_BAD };
  }
  const sameProperties =
    sent.length === draft.comparables.length &&
    sent.every((c, i) => typeof c?.address === "string" && addressKey(c.address) === addressKey(draft.comparables[i].address));
  if (Number(formData.get("espRevisionNo")) !== draft.espRevisionNo || !sameProperties) return { error: RELOAD };

  const parsed = soiContentFrom(
    {
      propertyType: formData.get("propertyType"),
      comparables: formData.get("comparables"),
      fewerReason: formData.get("fewerReason"),
      reports: formData.getAll("reports"),
      checked: formData.get("checked"),
    },
    {
      address: property.address,
      area: areaOf(property.council_area),
      preparedOn: sydneyToday(),
      preparedBy: await preparedByFor(ctx),
      espRevisionNo: draft.espRevisionNo,
    },
  );
  if ("error" in parsed) return { error: parsed.error };

  let bytes: Uint8Array;
  try {
    bytes = await buildSoiPdf(parsed.content);
  } catch {
    return { error: SAVE_FAILED };
  }
  const path = `${profile.agency_id}/${propertyId}/soi/${Date.now()}-statement-of-information.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) return { error: SAVE_FAILED };

  const { error } = await supabase.from("statements_of_information").insert({
    agency_id: profile.agency_id,
    property_id: propertyId,
    source: "realcomply",
    pdf_path: path,
    file_name: soiFilename(property.address),
    content: parsed.content,
    esp_revision_no: parsed.content.espRevisionNo,
    prepared_on: parsed.content.preparedOn,
  });
  if (error) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    return { error: plainError(error) };
  }
  await markCardDone(ctx, propertyId, versions.length + 1);
  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null, done: true };
}

/** One made elsewhere, already uploaded to the listing's soi folder: kept as the next version. */
export async function recordUploadedStatement(propertyId: string, _prev: SoiActionState, formData: FormData): Promise<SoiActionState> {
  const ctx = await requireAuthContext();
  const { supabase, profile } = ctx;
  const path = String(formData.get("path") ?? "");
  const fileName = String(formData.get("fileName") ?? "").trim().slice(0, 255) || "Statement of Information";
  const preparedOn = String(formData.get("preparedOn") ?? "");
  const espRevisionNo = Number(formData.get("espRevisionNo"));

  if (!path) return { error: "Upload the statement first." };
  if (!path.toLowerCase().endsWith(".pdf")) return { error: "Upload the statement as a PDF, so buyers can open it from the link." };
  if (!isInFolder(path, `${profile.agency_id}/${propertyId}/soi/`)) return { error: "That upload isn't in this listing's folder. Try again." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preparedOn)) return { error: "Enter the date it was prepared." };
  if (preparedOn > sydneyToday()) return { error: "The date it was prepared can't be in the future." };

  const listing = await listingFor(ctx, propertyId);
  if (!listing) return { error: SOI_BAD };
  const revisions = revisionsOrCard(await espRevisionsFor(supabase, profile.agency_id, propertyId), listing.allItems["d3"]);
  if (!Number.isInteger(espRevisionNo) || (espRevisionNo !== 0 && !revisions.some((r) => r.no === espRevisionNo))) {
    return { error: "Choose which ESP the statement is for." };
  }
  const empty = await storedFileProblem(supabase, path);
  if (empty) return { error: empty };

  if (!soiApplies(listing.allItems["a3"]?.event_date ?? null)) return { error: SOI_NOT_YET };
  const versions = await soiVersionsFor(supabase, propertyId);
  const { error } = await supabase.from("statements_of_information").insert({
    agency_id: profile.agency_id,
    property_id: propertyId,
    source: "uploaded",
    pdf_path: path,
    file_name: fileName,
    esp_revision_no: espRevisionNo,
    prepared_on: preparedOn,
  });
  if (error) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    return { error: plainError(error) };
  }
  await markCardDone(ctx, propertyId, versions.length + 1);
  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null, done: true };
}

/** Switch the link for online ads on or off. The link itself is the database's. */
export async function setStatementLink(propertyId: string, _prev: SoiActionState, formData: FormData): Promise<SoiActionState> {
  const ctx = await requireAuthContext();
  const { supabase, profile } = ctx;
  const on = formData.get("on") === "true";
  if (on) {
    const listing = await listingFor(ctx, propertyId);
    if (!listing) return { error: SOI_BAD };
    if (!soiApplies(listing.allItems["a3"]?.event_date ?? null)) return { error: SOI_NOT_YET };
  }
  const { data: existing } = await supabase
    .from("statement_of_information_links")
    .select("enabled")
    .eq("property_id", propertyId)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("statement_of_information_links").update({ enabled: on }).eq("property_id", propertyId)
    : on
      ? await supabase.from("statement_of_information_links").insert({ property_id: propertyId, agency_id: profile.agency_id, enabled: true })
      : { error: null };
  if (error) return { error: error.code === "P0001" && error.message ? error.message : "Couldn't change the link just now. Try again." };
  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null, done: true };
}
