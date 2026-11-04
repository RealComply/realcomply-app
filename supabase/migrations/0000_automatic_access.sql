-- ===== 0000: The automatic access RealComply's database was built with =====
--
-- Master's queue item 4 (grants for the older tables), 3 Nov 2026. No change
-- on live: this is already set there, exactly as below.
--
-- WHY: until 30 October 2026 every Supabase project gave the app's three
-- roles (anon, authenticated, service_role) access to anything new in public
-- automatically: full table rights on each new table, use of each new
-- sequence, and EXECUTE on each new function. New Supabase projects no longer
-- do (Supabase docs, "Securing your API": "Default privileges for new tables
-- and functions"). RealComply's live database was built with it on, and
-- migrations 0001 to 0110 were written that way:
--   * The 33 older tables (0001 to 0060, among them agencies, profiles,
--     properties and property_items) have no grants of their own. Their
--     access on live came only from this.
--   * Later migrations lean on it too, while they run and after. 0095 stops
--     with "the new columns aren't granted to signed-in users" unless
--     profiles and agency_invites already have it. 88 newer functions get the
--     service role's EXECUTE only from it, and 19 newer tables get some of
--     their rights (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) only from it.
-- So a file of grants added at the end can't rebuild the database: the
-- rebuild stops at 0095 before it reaches that file. Written down here, first,
-- the rebuild runs as live did, and ends with exactly live's grants on every
-- table, column, sequence and function (checked 3 Nov 2026 on a fresh copy
-- with the automatic access off, against live).
--
-- Adam's standing rule stays: every new table carries its own grants in the
-- same migration. Switching this off on live is a separate decision, not part
-- of this file.
--
-- Safe to run twice. On live it changes nothing.

-- The per-schema rules live has for the role that runs migrations, word for
-- word: postgres, anon, authenticated and service_role get every right on new
-- tables, sequences and functions in public.
alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;

-- Postgres's own rule that anyone may call a new function, which live keeps
-- (it has no database-wide rule of its own). A new project that takes it away
-- database-wide gets it back here; where it was never taken away, this
-- changes nothing.
alter default privileges for role postgres
  grant execute on functions to public;

-- ── Check ──────────────────────────────────────────────────────────────
-- One row, every value true.
with d as (
  select d.defaclobjtype as kind, pg_get_userbyid(x.grantee) as who, x.privilege_type as right_given
    from pg_default_acl d, aclexplode(d.defaclacl) x
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
     and x.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
)
select
  (select count(*) from d where kind = 'r' and right_given in
     ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')) = 21 as new_tables_open_to_the_app,
  (select count(*) from d where kind = 'S' and right_given in ('USAGE', 'SELECT', 'UPDATE')) = 9 as new_sequences_open_to_the_app,
  (select count(*) from d where kind = 'f' and right_given = 'EXECUTE') = 3 as new_functions_open_to_the_app,
  not exists (select 1 from pg_default_acl g
               where g.defaclrole = 'postgres'::regrole and g.defaclnamespace = 0 and g.defaclobjtype = 'f'
                 and not exists (select 1 from aclexplode(g.defaclacl) x
                                  where x.grantee = 0 and x.privilege_type = 'EXECUTE')) as anyone_may_call_new_functions;
