-- 0085: The rest of the stored files stay in their own office's folder too
-- (20 Oct 2026; Adam's yes on 19 Oct, after 0083).
--
-- 0083 put the rule on sign-off documents. Seven more places name a stored
-- file and had no such rule in the database:
--   1. agencies.logo_path (the office logo)
--   2. agencies.corporation_licence_document_path (the corporation's licence)
--   3. profiles.licence_document_path (a person's licence or certificate)
--   4. sg_manual_versions.file_path (the supervision and guidance manual)
--   5. trust_audits.file_path (the trust account audit)
--   6. training_plan_items.evidence_path (a training plan item's document)
--   7. property_items.data, the property reports register (f3): each entry's
--      evidencePath, the copy of the report
-- The app builds every one of these inside the office's own folder, but most
-- of them can also be written directly by someone in the office (the logo and
-- the corporation's licence by the licensee, a person's licence by them or
-- the licensee, a register entry by anyone who can see the listing).
--
-- The logo is the one read with full rights: the annexure and acknowledgement
-- PDFs, the annexure link page and the audit pack. A logo path into another
-- office's folder would have put that office's file into this office's
-- documents. The others are read through each person's own access, which
-- already stops at their own office's folder; the rule is the same for them so
-- that no stored file ever names another office's folder.
--
-- Prevention only: on 20 Oct every row was inside its own office's folder
-- (2 logos, 2 corporation licences, 6 licences, 3 manuals, 4 audits, no plan
-- item documents, 1 register report).
--
-- THE RULE, 0083's (public.path_in_agency_folder): it starts with the
-- office's id and a slash, has no ".." part, and is no longer than Storage
-- allows (1024 bytes). No file (null) is always allowed. A check on the table,
-- so it holds for every write, by anyone, including the platform's own jobs
-- and the logo's own function (set_agency_logo, 0030).
--
-- EXISTING ROWS. As in 0083: each check is added without re-reading the
-- table, then every existing row is checked in a separate step. A row outside
-- its folder would be left exactly as it is and named in a notice, with the
-- check in force for every new write; it does not fail the file.

-- The register's entries live inside one JSON value, and a check cannot look
-- through a list itself, so this does: every entry's copy of the report is in
-- the office's folder (or there is none).
create or replace function public.entry_files_in_agency_folder(p_data jsonb, p_agency_id uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(public.path_in_agency_folder(e ->> 'evidencePath', p_agency_id)), true)
    from jsonb_array_elements(
           case when jsonb_typeof(p_data -> 'entries') = 'array' then p_data -> 'entries' else '[]'::jsonb end
         ) e
   where jsonb_typeof(e) = 'object';
$$;
comment on function public.entry_files_in_agency_folder(jsonb, uuid) is
  'True when every entry in a card''s data (data.entries) names its file (evidencePath) inside that office''s own folder, or names none. Used for the property reports register (f3).';

do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('agencies', 'agencies_logo_in_own_folder',
       'public.path_in_agency_folder(logo_path, id)'),
      ('agencies', 'agencies_corporation_licence_document_in_own_folder',
       'public.path_in_agency_folder(corporation_licence_document_path, id)'),
      ('profiles', 'profiles_licence_document_in_own_folder',
       'public.path_in_agency_folder(licence_document_path, agency_id)'),
      ('sg_manual_versions', 'sg_manual_versions_file_in_own_folder',
       'public.path_in_agency_folder(file_path, agency_id)'),
      ('trust_audits', 'trust_audits_file_in_own_folder',
       'public.path_in_agency_folder(file_path, agency_id)'),
      ('training_plan_items', 'training_plan_items_evidence_in_own_folder',
       'public.path_in_agency_folder(evidence_path, agency_id)'),
      ('property_items', 'property_items_report_files_in_own_folder',
       'item_key <> ''f3'' or public.entry_files_in_agency_folder(data, agency_id)')
    ) as t(tbl, name, rule)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = format('public.%I', c.tbl)::regclass and conname = c.name) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.rule);
    end if;
    begin
      execute format('alter table public.%I validate constraint %I', c.tbl, c.name);
    exception when check_violation then
      raise notice '% (%) has rows outside their own office''s folder. They were left as they are; every new write is checked.',
        c.tbl, c.name;
    end;
  end loop;
end $$;

-- What you should see: one row. checks_in_force 7 (every row checked),
-- outside_own_folder 0.
select
  (select count(*) from pg_constraint
    where conname in ('agencies_logo_in_own_folder', 'agencies_corporation_licence_document_in_own_folder',
                      'profiles_licence_document_in_own_folder', 'sg_manual_versions_file_in_own_folder',
                      'trust_audits_file_in_own_folder', 'training_plan_items_evidence_in_own_folder',
                      'property_items_report_files_in_own_folder')
      and convalidated) as checks_in_force,
  (select count(*) from public.agencies
    where not public.path_in_agency_folder(logo_path, id)
       or not public.path_in_agency_folder(corporation_licence_document_path, id))
  + (select count(*) from public.profiles where not public.path_in_agency_folder(licence_document_path, agency_id))
  + (select count(*) from public.sg_manual_versions where not public.path_in_agency_folder(file_path, agency_id))
  + (select count(*) from public.trust_audits where not public.path_in_agency_folder(file_path, agency_id))
  + (select count(*) from public.training_plan_items where not public.path_in_agency_folder(evidence_path, agency_id))
  + (select count(*) from public.property_items
      where item_key = 'f3' and not public.entry_files_in_agency_folder(data, agency_id)) as outside_own_folder;
