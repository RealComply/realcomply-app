-- 0082: Empty files are refused in Storage (Adam, 19 Oct 2026).
--
-- Found on a live listing: an agency agreement and a market appraisal were
-- saved as 0-byte files and the cards took them as done. The app now refuses
-- an empty file on screen, before the upload, and on the server (lib/storage/
-- file-check.ts). This is the same rule in the database, so a file with
-- nothing in it can never be kept in the compliance-evidence bucket, whatever
-- route it comes by, including an upload path added later.
--
-- Storage records a file's size in metadata once the upload has finished, so
-- the refusal is on that write. The upload then fails and nothing is kept.
-- Rows written before the size is known (no metadata yet) are not touched,
-- and nor is any other bucket.
--
-- The two empty files already on record (19 Park Street) are not changed by
-- this; reopening those two cards is a separate step.

create or replace function public.refuse_empty_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.bucket_id = 'compliance-evidence'
     and jsonb_typeof(new.metadata -> 'size') = 'number'
     and (new.metadata ->> 'size')::numeric = 0
     -- The Supabase dashboard makes an empty file like this to show a folder.
     and new.name !~ '(^|/)\.emptyFolderPlaceholder$' then
    raise exception 'This file came through empty. You may be trying to upload a file stored in a cloud-based location. Download it to your computer, check it opens, then upload it again.'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke execute on function public.refuse_empty_evidence() from public, anon, authenticated;

drop trigger if exists compliance_evidence_refuse_empty on storage.objects;
create trigger compliance_evidence_refuse_empty
  before insert or update of metadata on storage.objects
  for each row execute function public.refuse_empty_evidence();
