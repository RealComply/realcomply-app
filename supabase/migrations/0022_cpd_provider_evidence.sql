-- CPD records get a provider and their evidence (18 Aug 2026).
--
-- 0021 established that a Fair Trading approved provider is what makes a
-- training activity count as CPD at all. But cpd_records had nowhere to put
-- the provider's name — it was being stuffed into the free-text `notes`
-- column, which means the one fact that decides whether a record qualifies
-- was living in a string nobody could query, filter or check.
--
-- If the provider is the gate, it is a column.
--
-- The evidence columns follow the same reasoning. Fair Trading requires the
-- agent to hold the provider's record of completion — issued within 10
-- business days, naming the topic, the assessment result, the hours and the
-- trainer — and to keep it 3 years (4 for a certificate of registration
-- holder's statement of attainment). A CPD register that records a claim
-- without the document behind it is the same shape of problem as the old
-- 45-box checklists: a tick with nothing under it.
--
-- Same upload-then-record-path pattern as licence documents and property
-- evidence, so nothing new is introduced on the storage side.

alter table public.cpd_records
  add column if not exists provider text,
  add column if not exists evidence_path text,
  add column if not exists evidence_file_name text;

comment on column public.cpd_records.provider is
  'The Fair Trading approved provider who delivered the activity — or, for an assistant agent''s unit of competency, the RTO that issued the statement of attainment. This is what makes a record count; an entry with no provider is office training, not CPD.';

comment on column public.cpd_records.evidence_path is
  'The provider''s record of completion. Fair Trading requires the agent to hold it and keep it 3 years (4 years for a certificate of registration holder''s statement of attainment).';

-- Backfill what we can. Where a record was created from a training plan item,
-- the provider was written into the notes as "— <provider>"; lift it out so
-- those rows are queryable rather than leaving them looking unattributed.
-- Anything it can't parse stays null, which is honest: null means "we don't
-- know who delivered this", and that is exactly the state those rows are in.
update public.cpd_records
   set provider = trim(substring(notes from 'training plan — (.*)$'))
 where provider is null
   and notes like '%training plan — %';
