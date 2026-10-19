-- 0083: A sign-off document's files stay in its own office's folder (19 Oct
-- 2026).
--
-- A sign-off document names two files: the one put out for signing
-- (file_path) and the copy with the signatures added (signed_file_path).
-- Nothing in the database said where either could point. The app always
-- builds them inside the office's own folder, but the signing step reads the
-- file with full database rights, so a path into another office's folder,
-- sent by hand, would have had another office's document copied into this
-- one. And whoever is asked to sign may update signed_file_path (0058), not
-- only the licensee.
--
-- Prevention only: on 19 Oct every row's files were inside their own office's
-- folder (24 documents, 23 signed copies; no voided signatures yet).
--
-- THE RULE, the insurance certificate's (0076, 0078): a check on the table,
-- so it holds for every write, by anyone, including the platform's own jobs.
-- Inside the office's own folder means:
--   * it starts with the office's id and a slash;
--   * no ".." part, which a web address would read as "go up a folder";
--   * no longer than Storage allows (1024 bytes).
-- The same for the copies kept when a signature is voided
-- (signoff_signature_voids), which carry the same two paths.
--
-- EXISTING ROWS. Each check is added without re-reading the table first, then
-- every existing row is checked in a separate step. If any row were outside
-- its folder, that step would leave the check in place for every new write,
-- leave the row exactly as it is, and say so; it does not fail the file.

create or replace function public.path_in_agency_folder(p_path text, p_agency_id uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_path is null
      or (octet_length(p_path) <= 1024
          and starts_with(p_path, p_agency_id::text || '/')
          and p_path !~ '(^|/)\.\.(/|$)');
$$;
comment on function public.path_in_agency_folder(text, uuid) is
  'True when a Storage path (compliance-evidence bucket) is inside that office''s own folder: starts with the office id and a slash, has no ".." part, and is at most 1024 bytes. Null is allowed (no file).';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('signoff_documents', 'file_path', 'signoff_documents_file_in_own_folder'),
      ('signoff_documents', 'signed_file_path', 'signoff_documents_signed_file_in_own_folder'),
      ('signoff_signature_voids', 'file_path', 'signoff_signature_voids_file_in_own_folder'),
      ('signoff_signature_voids', 'signed_file_path', 'signoff_signature_voids_signed_file_in_own_folder')
    ) as t(tbl, col, name)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = format('public.%I', c.tbl)::regclass and conname = c.name) then
      execute format(
        'alter table public.%I add constraint %I check (public.path_in_agency_folder(%I, agency_id)) not valid',
        c.tbl, c.name, c.col);
    end if;
    begin
      execute format('alter table public.%I validate constraint %I', c.tbl, c.name);
    exception when check_violation then
      raise notice '%.% has rows outside their own office''s folder. They were left as they are; every new write is checked.',
        c.tbl, c.col;
    end;
  end loop;
end $$;

-- What you should see: one row. checks_in_force 4 (every row checked),
-- outside_own_folder 0.
select
  (select count(*) from pg_constraint
    where conname in ('signoff_documents_file_in_own_folder', 'signoff_documents_signed_file_in_own_folder',
                      'signoff_signature_voids_file_in_own_folder', 'signoff_signature_voids_signed_file_in_own_folder')
      and convalidated) as checks_in_force,
  (select count(*) from public.signoff_documents
    where not public.path_in_agency_folder(file_path, agency_id)
       or not public.path_in_agency_folder(signed_file_path, agency_id))
  + (select count(*) from public.signoff_signature_voids
    where not public.path_in_agency_folder(file_path, agency_id)
       or not public.path_in_agency_folder(signed_file_path, agency_id)) as outside_own_folder;
