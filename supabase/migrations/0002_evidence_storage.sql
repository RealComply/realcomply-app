-- RealComply — evidence file storage
-- Adds a private Storage bucket for compliance evidence documents, with
-- RLS on storage.objects scoped to the caller's own agency via the object
-- path convention `${agency_id}/${property_id}/${item_key}/${filename}`.
-- property_items.evidence_path (already in 0001_init.sql) stores that path.

insert into storage.buckets (id, name, public)
values ('compliance-evidence', 'compliance-evidence', false)
on conflict (id) do nothing;

-- The first path segment is the agency_id — reuse current_agency_id() from
-- 0001_init.sql so this stays consistent with every other tenant-isolation
-- policy in the schema.
create policy "compliance-evidence: agency members can view"
  on storage.objects for select
  using (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

create policy "compliance-evidence: agency members can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

create policy "compliance-evidence: agency members can update"
  on storage.objects for update
  using (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );

create policy "compliance-evidence: agency members can delete"
  on storage.objects for delete
  using (
    bucket_id = 'compliance-evidence'
    and (storage.foldername(name))[1] = public.current_agency_id()::text
  );
