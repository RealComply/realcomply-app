-- Corporation licence (Adam, 15 Aug 2026).
--
-- The Licence register records one licence per person, taken from the
-- licence_* columns added to profiles in 0004_registers.sql. That covers the
-- individuals and misses the entity: in NSW a corporation carrying on business
-- as a real estate agent holds its own corporation licence, distinct from the
-- Class 1 or Class 2 licence held by the licensee in charge. Adam went looking
-- for somewhere to record it and there was nowhere to put it.
--
-- Agency-level, alongside the three insurance policies added in
-- 0010_agency_insurance_expansion.sql, and deliberately the same
-- number/expiry shape so the register can present it as one more card rather
-- than a special case.
--
-- holder is separate from agencies.name because the licensed entity is often
-- not what the office calls itself — the licence is held by the company
-- ("Cass Property Pty Ltd"), while agencies.name is the trading name people
-- type at signup. Storing one and displaying it as the other would put the
-- wrong name against a licence number.
alter table public.agencies
  add column corporation_licence_holder text,
  add column corporation_licence_number text,
  add column corporation_licence_expiry date;

comment on column public.agencies.corporation_licence_holder is
  'Legal name of the licensed corporation, which may differ from agencies.name (the trading name).';
