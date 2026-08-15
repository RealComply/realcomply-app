-- Licensee sign-off by link (Adam, 15 Aug 2026).
--
-- WHY THIS EXISTS. Stage 5's sign_licensee item is licenseeOnly, so only a
-- logged-in licensee in charge can complete it. That is fine for an agency
-- where the licensee uses RealComply, and impossible for the agent-only
-- subscription tier, where the subscriber is an individual salesperson whose
-- licensee has never heard of the product. In that tier there is currently no
-- way to obtain the one sign-off the entire liability posture rests on. This
-- migration adds the second path: a tokenised link the licensee opens, reads
-- and signs, with no account and no login.
--
-- Adam's decisions, taken 15 Aug 2026:
--   * BOTH paths. A licensee with a login keeps ticking it in-app; the link is
--     for the ones without. Neither replaces the other.
--   * The statement ties to the LISTING: property address, the date the
--     selling agency agreement was signed, and the estimated selling price.
--     Vendor names are deliberately NOT included — they are not stored on a
--     property today and he confirmed they are not needed for the sign-off to
--     be meaningful.
--   * The licensee's email is captured ONCE at agency setup, not per listing.
--
-- SEE ALSO RealComply-licensee-signoff-link.md for the full design, and
-- RealComply-email-notifications-scope.md for why the link is delivered by a
-- Copy-link button today rather than automatically by email (SES is still
-- sandboxed and will reject every external licensee).

-- ─────────────────────────────────────────────────────────────────────────
-- Agency-level licensee email.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.agencies
  add column licensee_email text;

comment on column public.agencies.licensee_email is
  'Email of the licensee in charge, for sign-off links. Captured at agency setup. May be the same as a profile email where the principal wears both hats.';

-- ─────────────────────────────────────────────────────────────────────────
-- One row per link issued.
--
-- statement is SNAPSHOTTED, not generated on read. The wording is a legal
-- record of what a person was shown before they signed; if it were rendered
-- live from the current template, a later copy change would silently rewrite
-- what every past licensee appears to have agreed to. Same reasoning as the
-- ruleset version stamped on the finalised compliance record.
-- ─────────────────────────────────────────────────────────────────────────
create table public.property_signoff_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,

  -- The credential. A v4 uuid is the only thing standing between the public
  -- internet and this file's summary, which is why the signing page must be
  -- noindex and the token must never appear in a page title or a redirect.
  token uuid not null default gen_random_uuid(),

  sent_to text not null,              -- address as at issue, kept even if the agency later changes it
  statement text not null,            -- exact text shown to the signer
  ruleset_version text,               -- e.g. 'NSW Sales Ruleset 2026.2', as at issue

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),

  signed_at timestamptz,
  signed_name text,
  revoked_at timestamptz
);

create unique index property_signoff_requests_token_key on public.property_signoff_requests(token);
create index property_signoff_requests_property_id_idx on public.property_signoff_requests(property_id);
create index property_signoff_requests_agency_id_idx on public.property_signoff_requests(agency_id);

alter table public.property_signoff_requests enable row level security;

-- Agency members can see and issue links for their own agency's listings.
-- There is deliberately NO anon policy of any kind: the public signing page
-- reaches this table only through the two SECURITY DEFINER functions below,
-- which take the token as their sole credential and return exactly what the
-- page needs. An anon SELECT policy keyed on the token would be equivalent to
-- publishing the table to anyone willing to guess.
create policy "signoff requests: agency members can view"
  on public.property_signoff_requests for select
  using (agency_id = public.current_agency_id());

create policy "signoff requests: agency members can issue"
  on public.property_signoff_requests for insert
  with check (agency_id = public.current_agency_id());

-- Revoking is the only update an agency member makes; signing happens through
-- submit_signoff() instead, so that a member cannot record that their licensee
-- signed something.
create policy "signoff requests: agency members can revoke"
  on public.property_signoff_requests for update
  using (agency_id = public.current_agency_id())
  with check (agency_id = public.current_agency_id());

-- ─────────────────────────────────────────────────────────────────────────
-- Public read, by token only.
--
-- Returns nothing at all for a token that is unknown, expired, revoked or
-- already signed — the page shows one "this link is no longer valid" state
-- for every one of those rather than distinguishing them, so the endpoint
-- cannot be used to probe which tokens exist.
-- ─────────────────────────────────────────────────────────────────────────
create function public.get_signoff_request(p_token uuid)
returns table (
  request_id uuid,
  statement text,
  ruleset_version text,
  property_address text,
  agency_name text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.statement, r.ruleset_version, p.address, a.name, r.expires_at
  from public.property_signoff_requests r
  join public.properties p on p.id = r.property_id
  join public.agencies a on a.id = r.agency_id
  where r.token = p_token
    and r.signed_at is null
    and r.revoked_at is null
    and r.expires_at > now();
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Public sign, by token only.
--
-- Records the signature AND completes the property's sign_licensee item in
-- one transaction, so the agent's file updates the moment the licensee
-- submits — which is exactly what Adam asked ("does that section
-- automatically get updated for us so the agent can move on?"). Two separate
-- writes would allow a signature with no corresponding completed item, i.e. a
-- licensee who believes they have signed off on a file that still shows as
-- outstanding.
--
-- Returns true when a signature was recorded, false when the token was not
-- valid or had already been used. The where-clause on signed_at makes a
-- double submission a no-op rather than a second signature.
-- ─────────────────────────────────────────────────────────────────────────
create function public.submit_signoff(p_token uuid, p_typed_name text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.property_signoff_requests;
begin
  if p_typed_name is null or btrim(p_typed_name) = '' then
    return false;
  end if;

  update public.property_signoff_requests
     set signed_at = now(),
         signed_name = btrim(p_typed_name)
   where token = p_token
     and signed_at is null
     and revoked_at is null
     and expires_at > now()
  returning * into v_request;

  if v_request.id is null then
    return false;
  end if;

  -- Mirrors the shape ItemCard/setItemStatus writes, so a link-signed item is
  -- indistinguishable in structure from one ticked in-app. signedVia records
  -- which route was used, because the difference matters when reconstructing
  -- who actually pressed the button months later.
  insert into public.property_items (agency_id, property_id, item_key, status, data)
  values (
    v_request.agency_id,
    v_request.property_id,
    'sign_licensee',
    'done',
    jsonb_build_object(
      'signedName', v_request.signed_name,
      'signedVia', 'link',
      'signoffRequestId', v_request.id
    )
  )
  on conflict (property_id, item_key) do update
    set status = 'done',
        data = public.property_items.data || excluded.data;

  return true;
end;
$$;

-- Both functions are the public signing page's only route into this data, so
-- anon must be able to call them. They are SECURITY DEFINER and take the token
-- as their sole credential; neither accepts an agency or property id, so
-- there is nothing to enumerate.
grant execute on function public.get_signoff_request(uuid) to anon, authenticated;
grant execute on function public.submit_signoff(uuid, text) to anon, authenticated;
