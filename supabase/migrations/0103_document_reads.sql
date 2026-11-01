-- ===== 0103: The record of document reads, and Adam's same-day alert (Adam, 1 Nov 2026) =====
--
-- WHY. On 30 Oct 2026 a comparable-sales report's answer was cut off at the
-- reader's length limit (1,536 tokens) and passed for "no sales found". Three
-- live listings went on without their comparables, and nobody was told
-- (PR #95). Adam, 1 Nov 2026: "stop a silent reader failure ever happening
-- again".
--
-- The app now treats every unfinished read as a failed one and says so on the
-- card. This file adds the part the database keeps:
--
--   1. document_reads: one row each time RealComply reads a document: which
--      reader (the comparable-sales report, a CPD certificate, ...), the
--      office, the listing when there is one, how it went (read, nothing
--      found, wrong document, failed), why it failed in a word ("cut_off",
--      "service", ...), and for a comparable-sales report how many sales it
--      found. Never the file's name or anything read from the file. Monday's
--      staff email counts these: reads done, reads failed, and
--      comparable-sales reports with 0 comparables, for the week.
--   2. reader_alerts: the same-day alert to Adam is sent at most once per
--      listing per day (Sydney time). A read that isn't on a listing (a CPD
--      certificate, a licence, an insurance certificate) counts per office
--      and per kind of document per day. A row here is the day's email for
--      that listing, claimed by the first read that needs one.
--   3. note_document_read(): how the app records a read. It works out the
--      office from the person signed in (or the listing's own office), checks
--      the listing is one they can open, writes the row, and says whether an
--      alert is due: a read that failed, or a comparable-sales report that
--      gave 0 comparables, and no alert yet today for that listing. When one
--      is due it also returns the office's name and the listing's address for
--      the email. The email itself is sent by the app, to Adam only.
--
-- Nobody reads or writes the two tables directly: no grants to anon or to
-- signed-in people, row level security on with no rules. Only
-- note_document_read() (as the person reading) and the service key (the
-- weekly email) reach them. Not covered by the end-of-subscription guard
-- (0054): nothing an office does writes here directly, and an office whose
-- subscription has ended has AI reading off. Not in the 7-year activity
-- record (0054): this is RealComply's own record of its reader, not the
-- office's activity. Both tables go with the office (and a row about a listing
-- goes with the listing) when it is deleted.
--
-- Two new tables, with their grants in this file. Nothing existing is
-- changed or deleted. Safe to run twice.

begin;

-- Order check: 0102 (office managers on the Complaints register) first.
do $$
begin
  if to_regclass('public.complaint_files') is null
     or to_regprocedure('public.can_see_property(uuid)') is null
     or to_regprocedure('public.current_agency_id()') is null then
    raise exception 'Run 0102 before this one. Nothing was changed.';
  end if;
end $$;

-- ── 1. The record of reads ─────────────────────────────────────────────────
create table if not exists public.document_reads (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  property_id uuid references public.properties (id) on delete cascade,
  -- Which reader: comparable_sales, contract, agency_agreement,
  -- revised_esp_notice, covering_letter, id_screen, inspection_report,
  -- cpd_certificate, licence, insurance_certificate. A short code, so a new
  -- reader needs no new migration.
  reader      text not null check (reader ~ '^[a-z][a-z_]{1,39}$'),
  outcome     text not null check (outcome in ('read', 'nothing_found', 'wrong_document', 'failed')),
  -- Why a read failed, in a word (cut_off, unparseable, refused, no_answer,
  -- too_large, unsupported, file, service, other). Only on a failed read.
  why         text check (why ~ '^[a-z][a-z_]{1,39}$'),
  -- Comparable sales found, for a comparable-sales report read to the end.
  sales       integer check (sales is null or sales >= 0),
  read_at     timestamptz not null default now(),
  constraint document_reads_why_only_when_failed check ((outcome = 'failed') = (why is not null))
);
create index if not exists document_reads_read_at_idx on public.document_reads (read_at);
create index if not exists document_reads_agency_idx on public.document_reads (agency_id, read_at);
create index if not exists document_reads_property_idx on public.document_reads (property_id);

comment on table public.document_reads is
  'One row per document read (0103, Adam 1 Nov 2026): reader, office, listing, outcome, why it failed, sales found. Never file names or anything read from a file. Counted in Adam''s Monday staff email. Written only by note_document_read().';

alter table public.document_reads enable row level security;
-- No rules, on purpose: nobody signed in reads or writes this table directly.

-- ── 2. One alert per listing per day ───────────────────────────────────────
create table if not exists public.reader_alerts (
  -- 'listing:<listing id>:<Sydney date>', or for a read that isn't on a
  -- listing 'office:<office id>:<reader>:<Sydney date>'.
  alert_key   text primary key check (char_length(alert_key) <= 200),
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  property_id uuid references public.properties (id) on delete cascade,
  claimed_at  timestamptz not null default now()
);
create index if not exists reader_alerts_agency_idx on public.reader_alerts (agency_id);
create index if not exists reader_alerts_property_idx on public.reader_alerts (property_id);

comment on table public.reader_alerts is
  'The same-day reader alert to Adam (0103, Adam 1 Nov 2026), at most one per listing per day (Sydney): a row is that day''s email, claimed by the first read that needs one. Written only by note_document_read().';

alter table public.reader_alerts enable row level security;
-- No rules, on purpose, as for document_reads.

-- Explicit grants. From 30 Oct 2026 Supabase stops granting new public tables
-- to the Data API automatically. Nothing for anon or signed-in people; the
-- service key reads both (Monday's staff email) and can tidy them.
revoke all on table public.document_reads from public, anon, authenticated;
revoke all on table public.reader_alerts from public, anon, authenticated;
grant select, insert, delete on public.document_reads to service_role;
grant select, insert, delete on public.reader_alerts to service_role;

-- ── 3. Recording a read ────────────────────────────────────────────────────
-- Called by the app as the person whose action made the read. Returns
-- {"alert": false}, or {"alert": true, "office": ..., "listing": ...} when
-- this read is the first today, for its listing, that needs an alert.
create or replace function public.note_document_read(
  p_reader      text,
  p_outcome     text,
  p_why         text default null,
  p_property_id uuid default null,
  p_sales       integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_agency  uuid;
  v_day     text := to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM-DD');
  v_key     text;
  v_claimed integer := 0;
  v_office  text;
  v_listing text;
begin
  if auth.uid() is null then
    raise exception 'Only someone signed in can record a read.' using errcode = '42501';
  end if;

  if p_property_id is not null then
    -- A listing they can open, recorded against the listing's own office.
    if not public.can_see_property(p_property_id) then
      raise exception 'That listing isn''t one you can open.' using errcode = '42501';
    end if;
    select agency_id into v_agency from public.properties where id = p_property_id;
  else
    v_agency := public.current_agency_id();
  end if;
  if v_agency is null then
    raise exception 'Not in an office.' using errcode = '42501';
  end if;

  insert into public.document_reads (agency_id, property_id, reader, outcome, why, sales)
  values (v_agency, p_property_id, p_reader, p_outcome,
          case when p_outcome = 'failed' then coalesce(p_why, 'other') end,
          case when p_sales is null then null else greatest(p_sales, 0) end);

  -- An alert is due for a failed read, and for a comparable-sales report
  -- that gave no comparable sales (read to the end, or the wrong document).
  if p_outcome = 'failed' or (p_reader = 'comparable_sales' and coalesce(p_sales, 0) = 0) then
    v_key := case when p_property_id is not null
                  then 'listing:' || p_property_id::text || ':' || v_day
                  else 'office:' || v_agency::text || ':' || p_reader || ':' || v_day end;
    insert into public.reader_alerts (alert_key, agency_id, property_id)
    values (v_key, v_agency, p_property_id)
    on conflict (alert_key) do nothing;
    get diagnostics v_claimed = row_count;
  end if;

  if v_claimed = 0 then
    return jsonb_build_object('alert', false);
  end if;

  select name into v_office from public.agencies where id = v_agency;
  if p_property_id is not null then
    select address into v_listing from public.properties where id = p_property_id;
  end if;
  return jsonb_build_object('alert', true, 'office', v_office, 'listing', v_listing);
end;
$$;
revoke execute on function public.note_document_read(text, text, text, uuid, integer) from public, anon;
grant execute on function public.note_document_read(text, text, text, uuid, integer) to authenticated, service_role;

commit;

-- What it shows when it has run: true, true, true, true.
select to_regclass('public.document_reads') is not null
         and to_regclass('public.reader_alerts') is not null as tables_ready,
       not has_table_privilege('authenticated', 'public.document_reads', 'select')
         and not has_table_privilege('authenticated', 'public.document_reads', 'insert')
         and not has_table_privilege('anon', 'public.document_reads', 'select')
         and not has_table_privilege('authenticated', 'public.reader_alerts', 'select')
         and not has_table_privilege('authenticated', 'public.reader_alerts', 'insert')
         and not has_table_privilege('anon', 'public.reader_alerts', 'select')
         and has_table_privilege('service_role', 'public.document_reads', 'select')
         and has_table_privilege('service_role', 'public.reader_alerts', 'select') as grants_right,
       (select relrowsecurity from pg_class where oid = 'public.document_reads'::regclass)
         and (select relrowsecurity from pg_class where oid = 'public.reader_alerts'::regclass) as rls_on,
       has_function_privilege('authenticated', 'public.note_document_read(text, text, text, uuid, integer)', 'execute')
         and not has_function_privilege('anon', 'public.note_document_read(text, text, text, uuid, integer)', 'execute')
         as recording_ready;
