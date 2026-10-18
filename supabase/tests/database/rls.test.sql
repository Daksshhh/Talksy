-- Security tests for RLS & function privileges. Run: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixture users (trigger creates profiles + preferences)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', '{}', '{}', now(), now()),
 ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', '{}', '{}', now(), now()),
 ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, '{}', '{}', now(), now());

select is((select count(*)::int from public.profiles where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000c3')), 3, 'profiles auto-created');

-- A and B become friends via a session-based request (service role path)
select public.create_random_session('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', 'Alpha', 'Bravo', 'aaaa1111', 'bbbb2222');
select lives_ok($$ select public.send_friend_request('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-000000000001') $$, 'friend request sent');
select throws_like($$ select public.send_friend_request('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-000000000001') $$, '%already sent%', 'duplicate pending request rejected');
select lives_ok($$ select public.respond_friend_request('00000000-0000-4000-8000-0000000000b2', (select id from public.friend_requests limit 1), true) $$, 'recipient accepts');
select ok(public.are_friends('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1'), 'friendship symmetric');

-- ---------- act as A (authenticated)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select public.send_dm((select id from public.direct_conversations limit 1), 'hello B', gen_random_uuid()) $$, 'friend can send DM via RPC');
select throws_ok($$ insert into public.direct_messages (conversation_id, sender_id, client_id, body)
                    values ((select id from public.direct_conversations limit 1), '00000000-0000-4000-8000-0000000000b2', gen_random_uuid(), 'forged') $$,
                 '42501', null, 'direct inserts (sender forgery) are denied');
select throws_ok($$ insert into public.admin_roles (user_id, role) values ('00000000-0000-4000-8000-0000000000a1', 'admin') $$, '42501', null, 'cannot self-grant admin');
select throws_ok($$ update public.profiles set display_name = 'Hacked' where id = '00000000-0000-4000-8000-0000000000b2' $$, '42501', null, 'cannot update other profiles');
select throws_ok($$ select public.send_friend_request('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-000000000001') $$, '42501', null, 'service-only functions not callable by clients');
select throws_ok($$ select public.admin_restrict_user('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', 'ban', 1, 'x') $$, '42501', null, 'admin functions not callable by clients');

-- ---------- act as C (stranger)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}', true);
select is_empty($$ select * from public.direct_messages $$, 'non-member cannot read DMs');
select is_empty($$ select * from public.notifications $$, 'cannot read other users notifications');
select is_empty($$ select * from public.profiles where id <> '00000000-0000-4000-8000-0000000000c3' $$, 'cannot read non-friend profiles');
select throws_like($$ select public.send_dm((select id from public.direct_conversations limit 1), 'intrude', gen_random_uuid()) $$, '%not found%', 'cannot post into a foreign conversation by id');
select throws_ok($$ select * from public.abuse_reports $$, '42501', null, 'reports are not readable by clients');

reset role;
select * from finish();
rollback;
