-- ===== Pending (G2): the person who uploaded an ID document RealComply refused can delete it, 10 October 2026 =====
--
-- Run after 0059. Safe to run more than once. Changes nothing else.
--
-- Found in the check of 10 Oct. Adam, 20 Aug 2026: "if the AI can detect any
-- ID documents, then it rejects them". The browser puts the file in storage
-- first (Vercel's 4.5MB limit), then uploadEvidence reads it and, if it is a
-- licence, passport, rates notice or the like, deletes it and tells the agent
-- "it hasn't been attached and has been deleted".
--
-- Since 0058 only the licensee deletes files ("Make it so that only a
-- licensee can delete compliance records", Adam, 9 Oct). So when an agent or
-- an assistant uploaded the ID document, the delete quietly did nothing and
-- the copy stayed in storage, on nobody's file, until the subscription ends.
--
-- A refused upload is not a compliance record: it was never attached to
-- anything. This lets the person who uploaded it delete it, and only while
-- all of this is true:
--   - they uploaded it (the file's owner is them),
--   - in the last 15 minutes (the check runs straight after the upload; 15
--     minutes is longer than the server will ever take over it),
--   - it is in a listing's a1 folder, {agency}/{listing}/a1/..., the vendor
--     identity card, which is the only card that refuses ID documents
--     (rejectIdDocuments in src/lib/rules/nsw-sales.ts; add a card here if
--     another one gets it),
--   - they may file to that listing (evidence_path_writable, 0058),
--   - and it is not attached to the card.
-- Anything attached, anything older, anyone else's file and every other
-- folder stay the licensee's to delete, as 0058 has them. The delete is
-- written to deletion_log like any other (0058, section 12).
--
-- Until this has run, the app says the copy could not be deleted rather than
-- saying it was.

create or replace function public.evidence_refused_upload_deletable(
  p_name text,
  p_owner text,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_seg text[] := storage.foldername(p_name);
begin
  if auth.uid() is null or p_owner is distinct from auth.uid()::text then
    return false;
  end if;
  if p_created_at is null or p_created_at <= now() - interval '15 minutes' then
    return false;
  end if;
  if coalesce(v_seg[2], '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_seg[3] is distinct from 'a1' then
    return false;
  end if;
  if not public.evidence_path_writable(p_name) then
    return false;
  end if;
  return not exists (select 1 from public.property_items i
                      where i.property_id = v_seg[2]::uuid
                        and i.evidence_path = p_name);
end
$$;
revoke execute on function public.evidence_refused_upload_deletable(text, text, timestamptz) from public, anon;
grant execute on function public.evidence_refused_upload_deletable(text, text, timestamptz) to authenticated;

drop policy if exists "compliance-evidence: uploader can delete a refused ID document" on storage.objects;
create policy "compliance-evidence: uploader can delete a refused ID document" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and public.evidence_refused_upload_deletable(name, coalesce(owner_id, owner::text), created_at));
