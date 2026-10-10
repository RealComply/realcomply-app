-- ===== Pending (G1a): licence uploads that were refused, 10 October 2026 =====
--
-- Not yet run anywhere. Safe to run more than once. Run after 0058 and 0059.
-- Everything is in one transaction: if any statement fails, nothing changes.
--
-- 1. A refused licence upload can be removed by the person who uploaded it.
--
--    Since 10 Oct an agent or assistant has their own licence card back on
--    Registers (it was hidden from them by the agent access change, while the
--    reminder emails kept sending them there to upload the renewal). When
--    they upload a document that turns out to be someone else's licence, or
--    not a licence at all, nothing is saved and the app removes the file
--    straight away: it is usually somebody else's personal document
--    (lib/actions/licences.ts, discardUpload).
--
--    0058 lets only the licensee delete files, so for an agent that removal
--    is quietly refused and the other person's licence stays in
--    {agency}/_licences/{agent}/. This allows exactly that one delete and
--    nothing else:
--      - in the person's own _licences folder,
--      - a file they uploaded themselves, in the last hour,
--      - that is not their licence document on record, and never was (no
--        licence_history row names it).
--    A licence document that is or was on the record stays the licensee's to
--    delete, the same as every other compliance record. The delete is still
--    written to deletion_log by the 0058 trigger on storage.objects.
--
-- 2. Refusals already stored are cleared.
--
--    Until 10 Oct a refused upload was also written to the record's
--    licence_read, with the name printed on the document: another person's
--    name kept in this person's record. The app no longer saves a refusal
--    (the warning is shown once, in the browser that uploaded it). This
--    clears the ones already saved, the same way a typed correction clears
--    them (recordTypedChanges in lib/licence-read.ts): lastRead goes back to
--    null and the rest of the read state is untouched.

begin;

drop policy if exists "compliance-evidence: own refused licence upload can be removed" on storage.objects;
create policy "compliance-evidence: own refused licence upload can be removed" on storage.objects
  for delete using (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
    and (storage.foldername(name))[2] = '_licences'
    and (storage.foldername(name))[3] = auth.uid()::text
    and owner_id = auth.uid()::text
    and created_at > now() - interval '1 hour'
    and not exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.licence_document_path = objects.name)
    and not exists (
      select 1 from public.licence_history h
       where h.profile_id = auth.uid()
         and (h.before ->> 'documentPath' = objects.name or h.after ->> 'documentPath' = objects.name)));

update public.profiles
   set licence_read = jsonb_set(licence_read, '{lastRead}', 'null'::jsonb)
 where licence_read -> 'lastRead' ->> 'status' in ('name_mismatch', 'not_a_licence');

update public.agencies
   set corporation_licence_read = jsonb_set(corporation_licence_read, '{lastRead}', 'null'::jsonb)
 where corporation_licence_read -> 'lastRead' ->> 'status' in ('name_mismatch', 'not_a_licence');

commit;
