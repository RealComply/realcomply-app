-- Stop office training accruing CPD hours (Adam, 18 Aug 2026).
--
-- THE DEFECT
-- ----------
-- Two places in the app wrote CPD records for training that may not be CPD
-- at all:
--
--   1. Marking attendance at a training session with "CPD eligible" ticked
--      auto-logged CPD hours for every attendee (recordAttendance in
--      registers.ts). Nothing checked who delivered it. An agent ticking the
--      box on a Monday sales meeting silently inflated their CPD tally, and
--      the licence register then reported them as having met a requirement
--      they had not met.
--   2. Completing an annual-training-plan item wrote a CPD record the same
--      way, regardless of what the program actually was.
--
-- This is the product's worst failure mode — telling someone they are fine
-- when they are not — applied to a requirement that is a condition of their
-- licence under s 20(2).
--
-- THE RULE, PRECISELY
-- -------------------
-- Verified 18 Aug 2026 against NSW Fair Trading's CPD requirements and its
-- conditions of approval for CPD providers.
--
--   "All CPD training in the property sector can only be delivered by an
--   approved provider." Only approved providers may deliver the compulsory
--   learning topics, which for 2026-27 is every published hour — there is no
--   elective or self-directed category in NSW at all.
--
-- The disqualifier is the PROVIDER AND THE CONTENT, NOT THE VENUE. This
-- matters and is easy to get backwards. An agency that engages REINSW or
-- another approved provider to deliver an approved topic AT ITS OWN OFFICE
-- does earn CPD — providers advertise exactly that, subcontracted delivery is
-- expressly permitted, and the record of completion merely records the place
-- rather than restricting it. What never counts is the agency's own internal
-- training: a sales meeting, an LIC-run session on the agency's procedures, a
-- product demo. The agency is not an approved provider, the session is not an
-- approved topic, and there is no compliant assessment or record of
-- completion behind it.
--
-- Assistant agents are stricter again: their three units are evidenced by a
-- statement of attainment, which only a registered training organisation can
-- issue, so in-house delivery cannot contribute at all.
--
-- TWO LEDGERS, WHICH IS THE REAL FIX
-- ----------------------------------
-- Office training is not worthless — the annual training plan (Requirement
-- 2.4) is expressly broader than CPD, and internal coaching belongs in it.
-- It just must never accrue against the CPD hours. So: one ledger for
-- approved-provider CPD, one for everything else, and a provider name as the
-- gate between them.

-- ── Sessions: a session only earns CPD if an approved provider delivered it ──
alter table public.training_sessions
  add column cpd_provider text;

comment on column public.training_sessions.cpd_provider is
  'The Fair Trading approved provider who delivered this session. Required before any CPD hours are recorded from it — an internal session has no provider and earns nothing. The venue is irrelevant: an approved provider delivering at the agency office does count.';

-- ── Plan items: explicit, and false by default ──────────────────────────────
-- Default false on purpose. The safe direction of error is a plan item that
-- earns no CPD when it should have — the agent notices at the register and
-- fixes it. The unsafe direction is silent credit for training that never
-- qualified, which nobody notices until renewal.
alter table public.training_plan_items
  add column counts_toward_cpd boolean not null default false;

comment on column public.training_plan_items.counts_toward_cpd is
  'True only where the program is delivered by a Fair Trading approved provider (or, for an assistant agent, an RTO issuing a statement of attainment). Completing an item only writes a CPD record when this is set. Default false: silent over-credit is the dangerous failure, under-credit is visible and self-correcting.';

-- ── Backfill: anything already credited without a provider is suspect ───────
-- Existing CPD rows auto-created from a session (source_session_id not null)
-- were written before any provider check existed, so none of them can be
-- shown to qualify. Rather than delete a record someone may genuinely have
-- earned, flag it in the notes so it is visible in the register and the
-- licensee can confirm or remove it. Deleting compliance data on the strength
-- of an inference is not our call to make.
update public.cpd_records
   set notes = coalesce(notes || ' | ', '')
     || 'NEEDS CHECK: auto-logged from an office training session before RealComply verified the provider. CPD only counts when delivered by a Fair Trading approved provider — confirm the provider and the record of completion, or remove this entry.'
 where source_session_id is not null;
