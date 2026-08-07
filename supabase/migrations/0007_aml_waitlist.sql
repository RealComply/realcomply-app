-- AML/CTF waitlist — captures interest from the /aml marketing landing page
-- (the Tranche 2 wedge: ~9,000 agencies newly in scope from 1 July 2026).
-- Unlike everything else in this schema, this table is filled in by
-- strangers who have never signed up and may never sign up — there is no
-- agency_id, no profile, no auth session. It is deliberately its own
-- small island: public insert-only, no read path for anon/authenticated at
-- all (rows are reviewed via the Supabase dashboard / service role until
-- there's a real admin screen for it).

create table public.aml_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text,
  agency_name text,
  role text, -- e.g. "Licensee in charge", "Agent", "Other" — free text from the form, not an enum, since this is a lead list, not a domain model
  property_count_band text, -- e.g. "1-50", "51-120" — matches the pricing bands on the brief, optional
  notes text,
  source text not null default 'aml-landing',
  created_at timestamptz not null default now()
);

-- Case-insensitive de-dupe: re-submitting the same email updates nothing
-- (the insert just fails) rather than creating duplicate lead rows.
create unique index aml_waitlist_email_idx on public.aml_waitlist (lower(email));

alter table public.aml_waitlist enable row level security;

-- Anyone — including a signed-out visitor — can add themselves. No select,
-- update, or delete policy exists for anon/authenticated, so a submitted
-- email address is genuinely write-only from the public side.
create policy "aml_waitlist: anyone can join"
  on public.aml_waitlist for insert
  to anon, authenticated
  with check (true);
