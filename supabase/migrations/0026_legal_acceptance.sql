-- 0026 — record who accepted which legal documents, and when.
--
-- Adam, 22 Aug 2026, after the first real inbound lead: the product cannot
-- take on another agency's data without published terms and a privacy policy,
-- and publishing them is only half of it. What a regulator or a court asks is
-- not "did they agree" but "to what, exactly, and when".
--
-- Hence a LOG, not a flag on the profile. Three reasons, and the third is the
-- one that decides it:
--   1. Documents get new versions. A boolean cannot say which one was agreed.
--   2. Re-acceptance after a material change has to be recordable without
--      destroying the earlier acceptance, which is still the operative one for
--      everything that happened before.
--   3. A row that can be updated is a row whose history can be quietly
--      rewritten. Evidence of agreement is worth having only if nobody can
--      edit it afterwards, so there is no update policy and no delete policy
--      on this table at all.
--
-- Safe to run more than once.

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Captured at acceptance rather than joined from profiles at read time. A
  -- person can change their email address later, and the record needs to say
  -- who agreed at the moment they agreed.
  email text,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now()
);

create index if not exists legal_acceptances_user_idx on public.legal_acceptances(user_id);
create index if not exists legal_acceptances_accepted_idx on public.legal_acceptances(accepted_at desc);

alter table public.legal_acceptances enable row level security;

do $$
begin
  -- Read your own. Deliberately not agency-wide: this is a record about a
  -- person, not about the agency, and a licensee does not need to read their
  -- staff's acceptance rows to run the business.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='legal_acceptances' and policyname='legal_acceptances: read own') then
    create policy "legal_acceptances: read own" on public.legal_acceptances
      for select using (user_id = auth.uid());
  end if;
end $$;

-- No insert policy either. The only way a row is created is through the
-- SECURITY DEFINER function below, which stamps user_id from auth.uid() rather
-- than accepting it as an argument. A client cannot forge an acceptance for
-- somebody else because it never gets to name the somebody.
create or replace function public.record_legal_acceptance(
  p_terms_version text,
  p_privacy_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if coalesce(trim(p_terms_version), '') = '' or coalesce(trim(p_privacy_version), '') = '' then
    raise exception 'a document version is required';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- Idempotent for a given person and version pair. Signup can call this and
  -- so can /auth/callback, depending on whether email confirmation is on, and
  -- on some paths both will run. Two identical rows a second apart would not
  -- be wrong exactly, but it makes the log harder to read than it needs to be.
  if exists (
    select 1 from public.legal_acceptances
    where user_id = auth.uid()
      and terms_version = p_terms_version
      and privacy_version = p_privacy_version
  ) then
    return;
  end if;

  insert into public.legal_acceptances (user_id, email, terms_version, privacy_version)
  values (auth.uid(), v_email, p_terms_version, p_privacy_version);
end;
$$;

select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='legal_acceptances') as table_expect_1,
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name='record_legal_acceptance') as function_expect_1;
