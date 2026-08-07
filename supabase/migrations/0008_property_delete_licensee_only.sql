-- Deleting a property destroys its whole compliance record (property_items
-- cascade-delete via the FK in 0001_init.sql) and is irreversible from the
-- app's point of view, so it should sit at the same trust level as the
-- other genuinely destructive/administrative actions in this schema
-- (revoking an invite, updating an invite) — licensee in charge only, not
-- any agency member. The original 0001_init.sql policy allowed any agency
-- member to delete; this tightens it to match the app-layer check in
-- deleteProperty() (lib/actions/properties.ts) with real DB-level
-- enforcement, not just a UI gate.

drop policy "properties: agency members can delete" on public.properties;

create policy "properties: licensee can delete"
  on public.properties for delete
  using (
    agency_id = public.current_agency_id()
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.is_licensee_in_charge
    )
  );
