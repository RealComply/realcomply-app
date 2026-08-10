-- Document sign-offs — a generic "upload a document, get the right people to
-- sign it, in RealComply, with no printing / external e-signature service"
-- register. First two uses (Adam, 9 Aug 2026): Supervision Guidelines Manual
-- versions, where every staff member individually signs, and trust account
-- end-of-month reconciliation reports, where only the licensee in charge
-- signs. Deliberately generic (category + signer_scope) rather than a
-- one-off table per document type, since the same shape covers whatever's
-- next — e.g. the SG v7 §2.7 Conflicts of Interest Policy, once adopted,
-- will need the same all-staff acknowledgement.
--
-- Legal note (not the schema's job to enforce, just why this is safe to
-- build in-house): this is the agency attesting to itself — a staff member
-- confirming they've read the current SG Manual, a licensee confirming
-- they've reviewed a reconciliation. That's a different, lighter bar than
-- binding an external party (vendor/purchaser) to a contract, which is what
-- FLK it over / a dedicated e-signature provider is for. A typed-name
-- signature with an immutable timestamp is ETA-2000-valid for this kind of
-- internal record. See RealComply-REINSW-forms-mapping.md §6 for the
-- platform-genericisation reasoning this follows.

create table public.signoff_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  category text not null,             -- 'sg_manual' | 'trust_reconciliation' | 'other'
  title text not null,
  period_label text,                  -- e.g. 'August 2026' — set for recurring monthly docs, null for one-offs
  file_path text not null,
  file_name text not null,
  notes text,
  signer_scope text not null,         -- 'all_staff' | 'licensee_only' — who signature rows get created for, below
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index signoff_documents_agency_id_idx on public.signoff_documents(agency_id);
create index signoff_documents_category_idx on public.signoff_documents(category);

-- One row per person required to sign a given document, created up front
-- (unsigned) when the document is published — see createSignoffDocument in
-- signoffs.ts. A person's own row is the only thing they can update (RLS
-- below), so nobody can record that a colleague signed something.
create table public.signoff_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.signoff_documents(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  signer_id uuid not null references public.profiles(id) on delete cascade,
  typed_name text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, signer_id)
);

create index signoff_signatures_document_id_idx on public.signoff_signatures(document_id);
create index signoff_signatures_agency_id_idx on public.signoff_signatures(agency_id);
create index signoff_signatures_signer_id_idx on public.signoff_signatures(signer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — same agency-wide-view trust model as every other register (see
-- 0004_registers.sql), except signature rows can only be *updated* (i.e.
-- actually signed) by the person they belong to — everyone else in the
-- agency can see who's signed and who hasn't, but only sign their own name.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.signoff_documents enable row level security;
alter table public.signoff_signatures enable row level security;

create policy "signoff_documents: agency members can view" on public.signoff_documents for select
  using (agency_id = public.current_agency_id());
create policy "signoff_documents: agency members can insert" on public.signoff_documents for insert
  with check (agency_id = public.current_agency_id());
create policy "signoff_documents: agency members can delete" on public.signoff_documents for delete
  using (agency_id = public.current_agency_id());

create policy "signoff_signatures: agency members can view" on public.signoff_signatures for select
  using (agency_id = public.current_agency_id());
-- Insert happens once, server-side, when the document is published (one row
-- per required signer, unsigned) — the publisher (the licensee) is creating
-- rows on behalf of colleagues at that point, so this only checks tenancy.
create policy "signoff_signatures: agency members can insert" on public.signoff_signatures for insert
  with check (agency_id = public.current_agency_id());
-- Actually signing (setting typed_name/signed_at) is restricted to the row's
-- own signer — this is the control that matters.
create policy "signoff_signatures: signer can sign their own row" on public.signoff_signatures for update
  using (agency_id = public.current_agency_id() and signer_id = auth.uid());
