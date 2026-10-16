-- MIGRATION 0081: optional mobile number on the early-access list
-- 16 October 2026
--
-- Adam: "add an optional mobile number to the early access registration form",
-- labelled "Mobile (optional): for a quick call to get you set up".
--
-- NULLABLE, and stays that way: the field is optional, and every row already on
-- the list predates it. The form only tidies what is typed (digits, spaces and
-- + ( ) . -); nothing is refused for not looking like a phone number. The
-- length check is a backstop against a paste accident, not a format rule.
--
-- No new table, so no grants block: the existing insert-only policy (0013)
-- covers the new column, and the anon key still cannot read the list back.
--
-- Safe to run more than once.

alter table public.early_access
  add column if not exists phone text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'early_access_phone_length') then
    alter table public.early_access
      add constraint early_access_phone_length check (phone is null or char_length(phone) <= 40);
  end if;
end $$;

comment on column public.early_access.phone is
  'Optional mobile or landline given on the early access form (16 Oct 2026), for a call to help them get set up. Null when not given and on every row before that date.';

-- ─────────────────────────────────────────────────────────────────────────
-- Verify (read only). Expect: phone_added true, length_check true, and the
-- count of rows already on the list (none of which has a number yet).
-- ─────────────────────────────────────────────────────────────────────────
select
  exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'early_access'
      and column_name = 'phone')                                         as phone_added,
  exists (select 1 from pg_constraint where conname = 'early_access_phone_length') as length_check,
  (select count(*) from public.early_access)                             as total_on_list;
