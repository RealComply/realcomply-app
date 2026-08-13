-- Insurance register, split out of Licence register (Adam, 13 Aug 2026):
-- PI insurance was bundled into the Licence register tab with no room for
-- anything else. Adds two more agency-level policy slots — cybersecurity
-- insurance and iCare workers insurance — alongside the existing PI
-- columns, same shape (insurer / policy number / expiry) so all three can
-- share one generic card component and one generic update action.
alter table public.agencies
  add column cyber_insurer text,
  add column cyber_policy_number text,
  add column cyber_expiry date,
  add column icare_insurer text,
  add column icare_policy_number text,
  add column icare_expiry date;
