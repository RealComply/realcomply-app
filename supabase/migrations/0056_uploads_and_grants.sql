-- ===== RUN THIS ONE. Migration 0056, upload limits and function grants, 9 October 2026 =====
--
-- MIGRATION 0056 — hardening: uploads and who can call what
--
-- From the engineer review of 9 Oct 2026 (findings 4 to 7), approved by Adam
-- the same day. Nothing here changes what a user sees, except the upload
-- message, which is in the app.
--
-- BEFORE RUNNING: the project-wide upload limit (Dashboard → Storage →
-- Settings → Upload file size limit) must be at least 150 MB, or part 1 is
-- capped by it.
--
--   1. compliance-evidence bucket: 150 MB per file, and only PDF, photos,
--      Word, Excel and saved emails. The app checks the same before upload
--      (lib/storage/evidence.ts) so the message is a plain one.
--   2. bootstrap_agency and bootstrap_agency_v2: no longer callable. Nothing
--      in the app calls them; bootstrap_agency_v3 replaced both. Not dropped.
--   3. A fixed search_path on five functions that lacked one. Bodies unchanged.
--   4. Execute on security definer functions narrowed to who actually calls
--      them. Postgres grants execute to PUBLIC by default, so each revoke
--      names public as well as anon, or it does nothing. service_role keeps
--      its own explicit grant on every function, so the server is unaffected.
--
-- KEPT CALLABLE BY SIGNED-OUT VISITORS, deliberately (Adam, 9 Oct 2026):
--   - the outside signer, invite and sign-up pages: get_signoff_request,
--     get_signoff_request_v2, submit_signoff, get_invite_preview,
--     invite_preview, founder_invite_valid, signups_open.
--   - current_agency_id, is_assistant, visible_agent_ids, is_platform_admin.
--     The access rules on the main tables and storage apply to everyone, not
--     only to signed-in users, and call these. Taking signed-out access away
--     would turn an empty result into an error for any signed-out request
--     that touches those tables, starting with /api/health. For a signed-out
--     caller they return no agency, false, no agents and false.
--   - bootstrap_agency_v3, left exactly as it is.

-- ── 1. Upload limits ───────────────────────────────────────────────────────

update storage.buckets
set file_size_limit = 150 * 1024 * 1024,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/heif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'message/rfc822',
      'application/vnd.ms-outlook'
    ]
where id = 'compliance-evidence';

-- ── 2. Old sign-up functions ───────────────────────────────────────────────

revoke execute on function public.bootstrap_agency(text, text) from public, anon, authenticated;
revoke execute on function public.bootstrap_agency_v2(text, text, boolean) from public, anon, authenticated;

-- ── 3. Fixed search path ───────────────────────────────────────────────────

alter function public.office_tier_for(integer) set search_path = public;
alter function public.agent_tier_for(integer) set search_path = public;
alter function public.implied_tier_for(text, integer) set search_path = public;
alter function public.touch_property_comparables() set search_path = public;
alter function public.touch_property_market_listings() set search_path = public;

-- ── 4a. Signed-in only ─────────────────────────────────────────────────────
--
-- Called by the signed-in app (sign-up runs these only once the session
-- exists), or by access rules that apply to signed-in users only.

revoke execute on function public.accept_invite(uuid, text) from public, anon;
revoke execute on function public.record_legal_acceptance(text, text) from public, anon;
revoke execute on function public.agency_listing_count(uuid) from public, anon;
revoke execute on function public.set_agency_licensee(text, text) from public, anon;
revoke execute on function public.set_agency_licensee_email(text) from public, anon;
revoke execute on function public.set_agency_website(text) from public, anon;
revoke execute on function public.set_agency_logo(text) from public, anon;
revoke execute on function public.set_agency_pm_records_system(text) from public, anon;
revoke execute on function public.set_agency_aml_precommencement(boolean) from public, anon;
revoke execute on function public.set_licensee_in_charge(boolean) from public, anon;
revoke execute on function public.agency_has_ended(uuid) from public, anon;
revoke execute on function public.storage_path_agency_has_ended(text) from public, anon;

grant execute on function public.accept_invite(uuid, text) to authenticated;
grant execute on function public.record_legal_acceptance(text, text) to authenticated;
grant execute on function public.agency_listing_count(uuid) to authenticated;
grant execute on function public.set_agency_licensee(text, text) to authenticated;
grant execute on function public.set_agency_licensee_email(text) to authenticated;
grant execute on function public.set_agency_website(text) to authenticated;
grant execute on function public.set_agency_logo(text) to authenticated;
grant execute on function public.set_agency_pm_records_system(text) to authenticated;
grant execute on function public.set_agency_aml_precommencement(boolean) to authenticated;
grant execute on function public.set_licensee_in_charge(boolean) to authenticated;
grant execute on function public.agency_has_ended(uuid) to authenticated;
grant execute on function public.storage_path_agency_has_ended(text) to authenticated;

-- ── 4b. Database only ──────────────────────────────────────────────────────
--
-- Called only from inside other database functions (which run as their
-- owner), by the server's admin key, or by triggers. Triggers fire whatever
-- the grant.

revoke execute on function public.agency_may_write(uuid) from public, anon, authenticated;
revoke execute on function public.agency_is_protected(uuid) from public, anon, authenticated;
revoke execute on function public.agency_is_protected_values(uuid, text, uuid) from public, anon, authenticated;

revoke execute on function public.agencies_track_end() from public, anon, authenticated;
revoke execute on function public.guard_agency_billing_columns() from public, anon, authenticated;
revoke execute on function public.guard_agency_may_write() from public, anon, authenticated;
revoke execute on function public.guard_agency_not_ended() from public, anon, authenticated;
revoke execute on function public.guard_last_licensee() from public, anon, authenticated;
revoke execute on function public.guard_listing_transfer() from public, anon, authenticated;
revoke execute on function public.pm_item_states_log() from public, anon, authenticated;
revoke execute on function public.pm_item_states_stamp() from public, anon, authenticated;
revoke execute on function public.pm_properties_check_manager() from public, anon, authenticated;
revoke execute on function public.pm_records_stamp() from public, anon, authenticated;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expected: the bucket row shows 157286400 and 11 types; then one row per
-- function. signed_out true for twelve only: the seven page functions, the
-- four rule helpers and bootstrap_agency_v3. signed_in false only for the
-- database-only functions and the two old bootstrap functions. server true
-- for every function.

select id, file_size_limit, array_length(allowed_mime_types, 1) as types
from storage.buckets where id = 'compliance-evidence';

select p.proname as function,
       has_function_privilege('anon', p.oid, 'execute') as signed_out,
       has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
       has_function_privilege('service_role', p.oid, 'execute') as server
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by signed_out desc, signed_in desc, p.proname;
