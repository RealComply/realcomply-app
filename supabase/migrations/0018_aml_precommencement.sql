-- AML/CTF pre-commencement customers (Adam, 17 Aug 2026).
--
-- THE PROBLEM. The vendor AML item (amv) is requiredForStageCompletion at
-- Stage 0, so an agent cannot move a listing forward until CDD is recorded.
-- On a listing whose agency agreement was signed before 1 July 2026 that may
-- be a wall in front of an obligation the agency does not actually owe, and
-- the file simply stops.
--
-- THE LAW, AS BEST WE CAN ESTABLISH IT. Real estate became a reporting sector
-- on 1 July 2026. For a seller's agent the designated service is brokering the
-- sale, and the accepted analysis is that it starts when the agency agreement
-- is signed. AUSTRAC's pre-commencement customer concept then says: if on
-- 1 July 2026 you already had a BUSINESS RELATIONSHIP with the customer (not
-- an occasional transaction) involving only real estate brokering, you do not
-- need initial CDD to keep providing that service.
--
-- WHY THIS IS A SWITCH AND NOT A RULE. Whether a single exclusive agency
-- agreement is a "business relationship" or an "occasional transaction" is the
-- load-bearing question, and neither AUSTRAC's guidance nor the practitioner
-- commentary we could find resolves it. So RealComply does not decide it. The
-- agency takes the position — on advice — and flips this switch; until then
-- nothing changes and amv behaves exactly as it always has.
--
-- Default false, deliberately. A legal position nobody has taken should not
-- arrive switched on, and an agency that never touches this keeps today's
-- behaviour forever.
--
-- WHAT THE SWITCH DOES NOT DO. It never satisfies amc (the Stage 4 "AML
-- COMPLETE" licensee sign-off). That stays a human decision by a named person,
-- because the AML/CTF compliance officer must be a named human. And it never
-- applies to the purchaser (amp) — a purchaser who appears after 1 July was
-- never a pre-commencement anything.
alter table public.agencies
  add column aml_precommencement_enabled boolean not null default false;

comment on column public.agencies.aml_precommencement_enabled is
  'When true, a listing whose agency agreement predates 1 July 2026 may satisfy the vendor AML item by recording pre-commencement customer status instead of initial CDD. Off by default; the agency takes this legal position, not RealComply.';

-- Same reasoning as set_agency_licensee_email (0014) and set_agency_website
-- (0017): agencies carries a SELECT policy only, and a general UPDATE policy
-- would expose every column on the table in order to set one flag.
--
-- Licensee-only, unlike the other two. Those record a fact about the agency
-- (an address, a website). This records a position on the law, and the person
-- who carries that is the licensee in charge.
create function public.set_agency_aml_precommencement(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid()
       and is_licensee_in_charge
  ) then
    raise exception 'Only the licensee in charge can change this setting.';
  end if;

  update public.agencies
     set aml_precommencement_enabled = coalesce(p_enabled, false)
   where id = public.current_agency_id();
end;
$$;

grant execute on function public.set_agency_aml_precommencement(boolean) to authenticated;
