-- ===== RUN THIS ONE. Migration 0074, the name on a CPD certificate, 15 October 2026 =====
--
-- Sue Edwards at Cass Property is "Sue Edwards" in RealComply and "Susan
-- Elizabeth Edwards" on her licence, so the licence read refused it.
--
-- REVERSAL (Adam, 15 Oct 2026): was (2 Oct licence-read brief, rule 4, kept
-- strict in #45): a holder name mismatch on a personal licence saves nothing.
-- Now: show what was read and ask the user to confirm it's this person's
-- licence; Yes saves, No removes the file. The same for a CPD certificate
-- whose name differs from the person.
--
-- A licence keeps its answer in the read it already stores (0051), so it
-- needs nothing here. A CPD certificate has nowhere to keep it, so this adds:
--
--   1. cpd_records.name_on_certificate: the name printed on the certificate,
--      kept only when it differed from the person and someone said "Yes, it's
--      theirs". Empty for every certificate whose name matched, and for every
--      record that exists today.
--   2. cpd_records.name_confirmed_by and name_confirmed_at: who said yes, and
--      when. The time is the database's own clock, not the browser's.
--   3. A guard, so the answer can only be given as yourself, and can't be
--      rewritten later. It is cleared only when the certificate itself is
--      removed or replaced, because it was about that file.
--
-- No new tables, so no new grants: the columns fall under the CPD policies
-- the table already has (own, or the licensee in charge). Nothing is deleted
-- and no existing record changes. Safe to run more than once.

begin;

-- Order check: 0022 (the certificate on a CPD record) and 0060 (its folder guard) first.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'cpd_records'
                    and column_name = 'evidence_path') then
    raise exception 'Run 0022 before this one. Nothing was changed.';
  end if;
  if to_regprocedure('public.guard_cpd_record_paths()') is null then
    raise exception 'Run 0060 before this one. Nothing was changed.';
  end if;
end $$;

alter table public.cpd_records add column if not exists name_on_certificate text;
alter table public.cpd_records add column if not exists name_confirmed_by uuid
  references public.profiles(id) on delete set null;
alter table public.cpd_records add column if not exists name_confirmed_at timestamptz;

create index if not exists cpd_records_name_confirmed_by_idx on public.cpd_records(name_confirmed_by);

-- All three or none. Who said yes can go empty later if their profile is
-- deleted; the name and the time stay.
alter table public.cpd_records drop constraint if exists cpd_records_name_confirmed_ok;
alter table public.cpd_records add constraint cpd_records_name_confirmed_ok check (
  (name_on_certificate is null and name_confirmed_by is null and name_confirmed_at is null)
  or (name_on_certificate is not null
      and char_length(btrim(name_on_certificate)) between 1 and 200
      and name_confirmed_at is not null)
);

comment on column public.cpd_records.name_on_certificate is
  'The name printed on the certificate, kept when it differed from the person and someone confirmed it was theirs (0074). Empty when the name matched.';
comment on column public.cpd_records.name_confirmed_by is
  'Who answered "Yes, it''s theirs" to the name on the certificate (0074).';
comment on column public.cpd_records.name_confirmed_at is
  'When they answered, by the database clock (0074).';

create or replace function public.guard_cpd_record_name()
returns trigger
language plpgsql
security invoker
set search_path = public
as $f$
begin
  -- Security invoker on purpose: current_user is then the caller's role.
  -- The service role and the database owner are not limited.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.name_on_certificate is not null or new.name_confirmed_by is not null or new.name_confirmed_at is not null then
      if auth.uid() is null or new.name_confirmed_by is distinct from auth.uid() then
        raise exception 'Only the person answering can confirm the name on a certificate.';
      end if;
      new.name_confirmed_at := now();
    end if;
    return new;
  end if;

  -- UPDATE: never rewritten. Cleared only with the certificate it was about.
  if new.name_on_certificate is distinct from old.name_on_certificate
     or new.name_confirmed_by is distinct from old.name_confirmed_by
     or new.name_confirmed_at is distinct from old.name_confirmed_at then
    if not (new.name_on_certificate is null and new.name_confirmed_by is null and new.name_confirmed_at is null
            and new.evidence_path is distinct from old.evidence_path) then
      raise exception 'This change is not allowed.';
    end if;
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_cpd_record_name() from public, anon, authenticated;
drop trigger if exists cpd_records_name_guard on public.cpd_records;
create trigger cpd_records_name_guard
  before insert or update on public.cpd_records
  for each row execute function public.guard_cpd_record_name();

-- ── Check ───────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'cpd_records'
      and column_name in ('name_on_certificate', 'name_confirmed_by', 'name_confirmed_at')) = 3 as columns_added,
  exists (select 1 from pg_trigger
           where tgrelid = 'public.cpd_records'::regclass and tgname = 'cpd_records_name_guard') as guard_on;

commit;
