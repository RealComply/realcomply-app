-- ===== RUN THIS ONE. Migration 0077, a certificate on an existing CPD row, 15 October 2026 =====
--
-- CPD certificates live in one place only: the CPD record (Adam, 15 Oct
-- 2026). A CPD row made by a training session, or by completing a training
-- plan item, now takes its certificate in that same place, instead of the
-- certificate making a second row.
--
-- The name on the certificate is checked the same way as for a new one
-- (0074): when it differs from the person, the uploader is asked "Is this
-- Jo's certificate?" and the answer is kept on the row. 0074's guard only
-- let that answer be written when the row was created. This lets it be
-- written on an existing row too, on the same terms:
--
--   * only together with a new certificate (the answer is about that file);
--   * only by the person answering (name_confirmed_by is them);
--   * timed by the database clock, whatever the app sends.
--
-- Everything else 0074 refuses stays refused: the answer can't be changed or
-- moved to another certificate, and it is cleared only with its certificate.
--
-- No new tables, so no new grants. Nothing is deleted and no row changes.
-- Safe to run more than once.

begin;

-- Order check: 0074 (the name answer and its guard) first.
do $$
begin
  if to_regprocedure('public.guard_cpd_record_name()') is null then
    raise exception 'Run 0074 before this one. Nothing was changed.';
  end if;
end $$;

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

  -- UPDATE: the answer belongs to one certificate. It changes only when the
  -- certificate does, and then it is either cleared or given afresh by the
  -- person answering (0077: a certificate attached to an existing row).
  if new.name_on_certificate is distinct from old.name_on_certificate
     or new.name_confirmed_by is distinct from old.name_confirmed_by
     or new.name_confirmed_at is distinct from old.name_confirmed_at then
    if new.evidence_path is not distinct from old.evidence_path then
      raise exception 'This change is not allowed.';
    end if;
    if new.name_on_certificate is null and new.name_confirmed_by is null and new.name_confirmed_at is null then
      return new;
    end if;
    if new.name_on_certificate is null or auth.uid() is null or new.name_confirmed_by is distinct from auth.uid() then
      raise exception 'Only the person answering can confirm the name on a certificate.';
    end if;
    new.name_confirmed_at := now();
  end if;
  return new;
end
$f$;
revoke execute on function public.guard_cpd_record_name() from public, anon, authenticated;

-- The trigger itself (0074) is unchanged: it calls the function above.

commit;

-- ── Verify. Expected: true, true ──
select
  exists (select 1 from pg_trigger
           where tgrelid = 'public.cpd_records'::regclass and tgname = 'cpd_records_name_guard') as guard_on,
  position('0077' in pg_get_functiondef('public.guard_cpd_record_name()'::regprocedure)) > 0 as allows_answer_with_new_certificate;
