-- ===== READ ONLY. Sign-off files in their own office's folder, 19 October 2026 =====
--
-- Proves supabase/migrations/0083_signoff_files_in_own_folder.sql. Run after it.
-- Safe on the live database: everything happens inside one transaction that
-- is rolled back at the end, so the made-up offices and people it creates
-- never exist outside it.
--
-- Pass: the last line says "Sign-off files: all checks passed".
-- Fail: it stops with an error naming the check that failed.

begin;

do $$
declare
  ag uuid := gen_random_uuid();      -- an office
  ag2 uuid := gen_random_uuid();     -- another office
  lic uuid := gen_random_uuid();     -- its licensee in charge
  agt uuid := gen_random_uuid();     -- one of its agents, asked to sign
  doc uuid := gen_random_uuid();     -- a document put out for signing
  own text;
  other text;
  n integer;
begin
  insert into auth.users (id, email) values
    (lic, 'sf-lic@example.invalid'), (agt, 'sf-agent@example.invalid');
  insert into public.agencies (id, name, plan, status) values
    (ag, 'SF Property (made up)', 'office_1', 'active'),
    (ag2, 'SF Other Property (made up)', 'office_1', 'active');
  insert into public.profiles (id, agency_id, full_name, email, is_licensee_in_charge, is_assistant, is_agent) values
    (lic, ag, 'SF Licensee', 'sf-lic@example.invalid', true, false, true),
    (agt, ag, 'SF Agent', 'sf-agent@example.invalid', false, false, true);
  own := ag::text || '/_signoffs/other/1-policy.pdf';
  other := ag2::text || '/_signoffs/other/1-their-policy.pdf';

  -- Done as the licensee, through the same rules the app uses.
  perform set_config('request.jwt.claims', json_build_object('sub', lic, 'role', 'authenticated')::text, true);

  -- 1. A document in the office's own folder is put out for signing.
  set local role authenticated;
  insert into public.signoff_documents (id, agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
  values (doc, ag, 'other', 'Office policy (made up)', own, '1-policy.pdf', 'all_staff', lic);
  insert into public.signoff_signatures (document_id, agency_id, signer_id) values (doc, ag, agt);
  reset role;
  select count(*) into n from public.signoff_documents where id = doc and file_path = own;
  if n <> 1 then raise exception 'FAIL 1: a document in the office''s own folder was not saved'; end if;

  -- 2. One in another office's folder is refused.
  begin
    set local role authenticated;
    insert into public.signoff_documents (agency_id, category, title, file_path, file_name, signer_scope, uploaded_by)
    values (ag, 'other', 'Not ours (made up)', other, '1-their-policy.pdf', 'all_staff', lic);
    reset role;
    raise exception 'FAIL 2: a document in another office''s folder was saved';
  exception when check_violation then
    reset role;
  end;

  -- 3. Nor can a document be pointed there afterwards.
  begin
    set local role authenticated;
    update public.signoff_documents set file_path = other where id = doc;
    reset role;
    raise exception 'FAIL 3: a document was moved to another office''s folder';
  exception when check_violation then
    reset role;
  end;

  -- 4. A ".." part, which a web address reads as "go up a folder", is refused
  --    even when the path starts in the office's own folder.
  begin
    set local role authenticated;
    update public.signoff_documents set file_path = ag::text || '/../' || ag2::text || '/x.pdf' where id = doc;
    reset role;
    raise exception 'FAIL 4: a path climbing out of the office''s folder was saved';
  exception when check_violation then
    reset role;
  end;

  -- 5. The signed copy: the agent asked to sign may attach one in the
  --    office's own folder, and not one anywhere else.
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.signoff_documents set signed_file_path = ag::text || '/_signoffs/signed/1-policy (signed).pdf',
                                      signed_file_name = '1-policy (signed).pdf'
   where id = doc;
  reset role;
  select count(*) into n from public.signoff_documents where id = doc and signed_file_path like ag::text || '/_signoffs/signed/%';
  if n <> 1 then raise exception 'FAIL 5: the signer could not attach a signed copy in the office''s own folder'; end if;
  begin
    set local role authenticated;
    update public.signoff_documents set signed_file_path = other where id = doc;
    reset role;
    raise exception 'FAIL 5: the signer pointed the signed copy at another office''s folder';
  exception when check_violation then
    reset role;
  end;

  -- 6. The same holds for the platform's own jobs (here, the table's owner),
  --    not only for people signed in.
  begin
    update public.signoff_documents set signed_file_path = other where id = doc;
    raise exception 'FAIL 6: the platform pointed a signed copy at another office''s folder';
  exception when check_violation then
    null;
  end;

  -- 7. Copies kept when a signature is voided carry the same rule.
  begin
    insert into public.signoff_signature_voids (agency_id, document_id, signer_id, typed_name, signed_at, file_path, file_name, signed_file_path)
    values (ag, doc, agt, 'SF Agent', now(), other, 'x.pdf', null);
    raise exception 'FAIL 7: a voided signature''s copy pointed at another office''s folder';
  exception when check_violation then
    null;
  end;
  insert into public.signoff_signature_voids (agency_id, document_id, signer_id, typed_name, signed_at, file_path, file_name, signed_file_path)
  values (ag, doc, agt, 'SF Agent', now(), own, '1-policy.pdf', null);

  -- 8. A signed copy can be taken off (no file), and the document is untouched otherwise.
  update public.signoff_documents set signed_file_path = null, signed_file_name = null where id = doc;
  select count(*) into n from public.signoff_documents where id = doc and file_path = own and signed_file_path is null;
  if n <> 1 then raise exception 'FAIL 8: taking the signed copy off did not save'; end if;

  -- 9. Every check is in force and has been checked against every row there was.
  select count(*) into n from pg_constraint
   where conname in ('signoff_documents_file_in_own_folder', 'signoff_documents_signed_file_in_own_folder',
                     'signoff_signature_voids_file_in_own_folder', 'signoff_signature_voids_signed_file_in_own_folder')
     and convalidated;
  if n <> 4 then raise exception 'FAIL 9: % of the 4 checks are in force for every row, expected 4', n; end if;
end $$;

select 'Sign-off files: all checks passed' as result;

rollback;
