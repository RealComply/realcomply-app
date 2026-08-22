-- ===== RUN THIS ONE. Migration 0028, ESP card merge, 22 Aug 2026 =====
--
-- Adam, 22 Aug 2026: "estimated selling price recorded and comparable sales
-- evidence held [are] two different cards on the same page. We only need one
-- of them." s72A is one obligation, not two: record the estimate, and hold
-- reasonable grounds for it. So a4b is merged into a4 and the comparable-sales
-- report now hangs off the same card as the figure it supports.
--
-- MUST RUN BEFORE THE CODE DEPLOYS.
--
-- Every listing created so far has its comparable-sales report filed against
-- item a4b. Once a4b stops existing in the rules, nothing renders it: the file
-- is still in the bucket and the row is still in the table, but it disappears
-- from the compliance file, which to anyone looking at it is indistinguishable
-- from having been deleted. This moves each report onto a4 first.
--
-- Safe to run more than once: the update only fires where a4 has no evidence
-- of its own, so a second run finds nothing left to move.
--
-- Nothing is deleted. The old a4b rows are left exactly where they are, minus
-- the evidence pointer. They stop being read the moment the code goes up, and
-- keeping them means this is reversible by hand if the merge turns out wrong.

begin;

-- 1. Move the report onto the ESP card.
--
-- The evidence_path is the pointer to the object in storage; evidenceFileName
-- inside data is what the card prints. They travel together or the card shows
-- a nameless attachment.
--
-- Note what is NOT carried across: a4b's findings note. The merged card has no
-- findings box, deliberately (see the merge note on a4 in rules/nsw-sales.ts),
-- and a4's own data already holds espLow/espHigh which must survive untouched.
-- So this writes exactly two keys and leaves the rest of a4's data alone.
update public.property_items as a4
   set evidence_path = a4b.evidence_path,
       data = coalesce(a4.data, '{}'::jsonb)
              || jsonb_build_object(
                   'evidenceFileName',
                   coalesce(a4b.data ->> 'evidenceFileName', 'Comparable sales report')
                 )
  from public.property_items as a4b
 where a4b.property_id = a4.property_id
   and a4b.item_key = 'a4b'
   and a4.item_key = 'a4'
   and a4b.evidence_path is not null
   -- Never overwrite a report already sitting on a4. If both have one, the
   -- one on a4 is the newer of the two and wins.
   and a4.evidence_path is null;

-- 2. The listing that has a4b but no a4 row at all.
--
-- Possible on an older listing where the ESP figures were never entered, so
-- nothing ever created the a4 row. Without this the report has nowhere to land
-- and step 1 silently skips it.
insert into public.property_items (agency_id, property_id, item_key, status, data, evidence_path)
select a4b.agency_id,
       a4b.property_id,
       'a4',
       'open',
       jsonb_build_object(
         'evidenceFileName',
         coalesce(a4b.data ->> 'evidenceFileName', 'Comparable sales report')
       ),
       a4b.evidence_path
  from public.property_items as a4b
 where a4b.item_key = 'a4b'
   and a4b.evidence_path is not null
   and not exists (
     select 1
       from public.property_items as existing
      where existing.property_id = a4b.property_id
        and existing.item_key = 'a4'
   )
on conflict (property_id, item_key) do nothing;

-- 3. Release the pointer on the old rows.
--
-- Two rows pointing at one object is a trap: removeEvidence on either would
-- delete the object out from under the other. Clearing it here leaves the a4b
-- row as an inert record of what used to be there, with a4 as the only owner.
update public.property_items
   set evidence_path = null
 where item_key = 'a4b'
   and evidence_path is not null
   and exists (
     select 1
       from public.property_items as a4
      where a4.property_id = property_items.property_id
        and a4.item_key = 'a4'
        and a4.evidence_path is not null
   );

commit;

-- Check. Expect moved_to_a4 to equal the number of listings you have, and both
-- still_on_a4b and orphaned to be 0.
select
  (select count(*) from public.property_items
     where item_key = 'a4' and evidence_path is not null) as moved_to_a4,
  (select count(*) from public.property_items
     where item_key = 'a4b' and evidence_path is not null) as still_on_a4b_expect_0,
  (select count(*) from public.property_items as a4b
     where a4b.item_key = 'a4b'
       and not exists (select 1 from public.property_items as a4
                        where a4.property_id = a4b.property_id
                          and a4.item_key = 'a4'
                          and a4.evidence_path is not null)) as orphaned_expect_0;
