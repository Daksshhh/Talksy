-- =====================================================================
-- OrbitChat - atomic business functions
-- Error convention: RAISE EXCEPTION '<code>:<message>' USING ERRCODE='P0001'
-- (mapped to typed HTTP errors by the Worker).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal guards
-- ---------------------------------------------------------------------
create or replace function public.assert_not_restricted(p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.active_restriction(p_user);
  if found then
    raise exception 'restricted:Your account is %', case when r.kind = 'ban' then 'banned' else 'temporarily suspended' end
      using errcode = 'P0001';
  end if;
end $$;

create or replace function public.notify_user(p_user uuid, p_type text, p_title text, p_body text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, data) values (p_user, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb));
end $$;

create or replace function public.ensure_conversation(a uuid, b uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.direct_conversations (user_a, user_b) values (least(a, b), greatest(a, b))
  on conflict (user_a, user_b) do nothing;
  select id into v_id from public.direct_conversations where user_a = least(a, b) and user_b = greatest(a, b);
  insert into public.direct_conversation_members (conversation_id, user_id) values (v_id, a), (v_id, b)
  on conflict do nothing;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Random sessions (called by the ChatRoom Durable Object)
-- ---------------------------------------------------------------------
create or replace function public.create_random_session(
  p_session uuid, p_user_a uuid, p_user_b uuid,
  p_name_a text, p_name_b text, p_seed_a text, p_seed_b text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.random_chat_sessions (id, status) values (p_session, 'CREATING') on conflict (id) do nothing;
  insert into public.random_chat_participants (session_id, user_id, display_name, avatar_seed)
  values (p_session, p_user_a, p_name_a, coalesce(p_seed_a, '')), (p_session, p_user_b, p_name_b, coalesce(p_seed_b, ''))
  on conflict do nothing;
end $$;

create or replace function public.set_random_session_status(p_session uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.random_chat_sessions
     set status = p_status,
         ended_at = case when p_status = 'ENDED' then coalesce(ended_at, now()) else ended_at end,
         end_reason = case when p_status = 'ENDED' then coalesce(end_reason, p_reason) else end_reason end
   where id = p_session and status <> 'ENDED';
end $$;

-- Persist a transcript ONLY when both participants consented.
create or replace function public.save_random_transcript(p_session uuid, p_consented uuid[], p_messages jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if (select count(*) from public.random_chat_participants
       where session_id = p_session and user_id = any(p_consented)) < 2 then
    raise exception 'forbidden:Both participants must consent' using errcode = 'P0001';
  end if;
  insert into public.conversation_save_consents (session_id, user_id)
  select p_session, u from unnest(p_consented) u on conflict do nothing;
  insert into public.saved_random_messages (session_id, seq, sender_id, body, sent_at)
  select p_session, (m->>'seq')::int, nullif(m->>'senderId', '')::uuid, m->>'text', to_timestamp((m->>'ts')::bigint / 1000.0)
    from jsonb_array_elements(p_messages) m
   where coalesce(m->>'senderId', '') <> ''
  on conflict (session_id, seq) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------
create or replace function public.get_history(p_actor uuid, p_before timestamptz default null, p_limit int default 20)
returns jsonb language sql stable security definer set search_path = public as $$
  with mine as (
    select s.id, s.started_at, s.ended_at, s.status, s.end_reason, me.display_name as my_name
      from public.random_chat_participants me
      join public.random_chat_sessions s on s.id = me.session_id
     where me.user_id = p_actor and me.hidden_at is null
       and (p_before is null or s.started_at < p_before)
     order by s.started_at desc
     limit least(greatest(p_limit, 1), 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', m.id,
    'startedAt', m.started_at,
    'endedAt', m.ended_at,
    'durationSec', case when m.ended_at is null then null else extract(epoch from (m.ended_at - m.started_at))::int end,
    'status', m.status,
    'endReason', m.end_reason,
    'myName', m.my_name,
    'strangerName', o.display_name,
    'strangerAvatarSeed', o.avatar_seed,
    'friendRequestSent', exists (select 1 from public.friend_requests fr where fr.session_id = m.id and fr.sender_id = p_actor),
    'becameFriends', o.user_id is not null and public.are_friends(p_actor, o.user_id),
    'transcriptSaved', exists (select 1 from public.conversation_save_consents c
                                where c.session_id = m.id and c.user_id = p_actor and c.revoked_at is null)
                       and exists (select 1 from public.saved_random_messages sm where sm.session_id = m.id),
    'canSendFriendRequest', o.user_id is not null
                            and m.started_at > now() - interval '7 days'
                            and not public.are_friends(p_actor, o.user_id)
                            and not public.is_blocked_pair(p_actor, o.user_id)
  ) order by m.started_at desc), '[]'::jsonb)
  from mine m
  left join public.random_chat_participants o on o.session_id = m.id and o.user_id <> p_actor;
$$;

create or replace function public.get_history_transcript(p_actor uuid, p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversation_save_consents
                  where session_id = p_session and user_id = p_actor and revoked_at is null) then
    return null;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', id, 'from', case when sender_id = p_actor then 'me' else 'peer' end,
            'text', body, 'ts', sent_at) order by seq), '[]'::jsonb)
            from public.saved_random_messages where session_id = p_session);
end $$;

create or replace function public.hide_history_item(p_actor uuid, p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.random_chat_participants set hidden_at = now()
   where session_id = p_session and user_id = p_actor;
  if not found then raise exception 'not_found:History item not found' using errcode = 'P0001'; end if;
  perform public.revoke_transcript(p_actor, p_session);
end $$;

-- Either participant can withdraw; once nobody retains access the transcript is deleted.
create or replace function public.revoke_transcript(p_actor uuid, p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.conversation_save_consents set revoked_at = now()
   where session_id = p_session and user_id = p_actor and revoked_at is null;
  if not exists (select 1 from public.conversation_save_consents where session_id = p_session and revoked_at is null) then
    delete from public.saved_random_messages where session_id = p_session;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Friend requests (session-based: no public user search)
-- ---------------------------------------------------------------------
create or replace function public.send_friend_request(p_actor uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_req public.friend_requests;
  v_reverse public.friend_requests;
  v_started timestamptz;
  v_allow boolean;
  v_notify boolean;
  v_name text;
begin
  perform public.assert_not_restricted(p_actor);

  select o.user_id, s.started_at into v_target, v_started
    from public.random_chat_participants me
    join public.random_chat_participants o on o.session_id = me.session_id and o.user_id <> me.user_id
    join public.random_chat_sessions s on s.id = me.session_id
   where me.session_id = p_session and me.user_id = p_actor;
  if v_target is null then raise exception 'not_found:Chat session not found' using errcode = 'P0001'; end if;
  if v_target = p_actor then raise exception 'bad_request:You cannot add yourself' using errcode = 'P0001'; end if;
  if v_started < now() - interval '7 days' then
    raise exception 'forbidden:Friend requests are only possible for recent chats' using errcode = 'P0001';
  end if;
  if public.is_blocked_pair(p_actor, v_target) then
    raise exception 'blocked:You cannot send a request to this user' using errcode = 'P0001';
  end if;
  if public.are_friends(p_actor, v_target) then
    raise exception 'conflict:You are already friends' using errcode = 'P0001';
  end if;
  select allow_match_requests, notify_friend_requests into v_allow, v_notify
    from public.user_preferences where user_id = v_target;
  if not coalesce(v_allow, true) then
    raise exception 'forbidden:This user is not accepting friend requests' using errcode = 'P0001';
  end if;

  -- Reverse pending request => accept it (mutual interest).
  select * into v_reverse from public.friend_requests
   where sender_id = v_target and recipient_id = p_actor and status = 'pending' for update;
  if found then
    return public.respond_friend_request(p_actor, v_reverse.id, true);
  end if;

  if exists (select 1 from public.friend_requests where sender_id = p_actor and recipient_id = v_target and status = 'pending') then
    raise exception 'conflict:Request already sent' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.friend_requests
              where sender_id = p_actor and recipient_id = v_target and status = 'declined'
                and responded_at > now() - interval '72 hours') then
    raise exception 'cooldown:Please wait before sending another request' using errcode = 'P0001';
  end if;
  if (select count(*) from public.friend_requests where sender_id = p_actor and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited:Too many friend requests. Try again later.' using errcode = 'P0001';
  end if;

  insert into public.friend_requests (sender_id, recipient_id, session_id)
  values (p_actor, v_target, p_session) returning * into v_req;

  if coalesce(v_notify, true) then
    select display_name into v_name from public.profiles where id = p_actor;
    perform public.notify_user(v_target, 'friend_request', 'New friend request',
      coalesce(v_name, 'Someone') || ' wants to be friends', jsonb_build_object('requestId', v_req.id));
  end if;
  return jsonb_build_object('id', v_req.id, 'status', v_req.status, 'recipientId', v_target);
end $$;

create or replace function public.respond_friend_request(p_actor uuid, p_request uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_req public.friend_requests;
  v_conv uuid;
  v_name text;
begin
  select * into v_req from public.friend_requests where id = p_request for update;
  if not found or v_req.recipient_id <> p_actor then
    raise exception 'not_found:Request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'conflict:This request was already %', v_req.status using errcode = 'P0001';
  end if;
  if p_accept then
    perform public.assert_not_restricted(p_actor);
    if public.is_blocked_pair(v_req.sender_id, v_req.recipient_id) then
      raise exception 'blocked:This request can no longer be accepted' using errcode = 'P0001';
    end if;
    update public.friend_requests set status = 'accepted', responded_at = now() where id = p_request;
    insert into public.friendships (user_a, user_b)
    values (least(v_req.sender_id, v_req.recipient_id), greatest(v_req.sender_id, v_req.recipient_id))
    on conflict do nothing;
    v_conv := public.ensure_conversation(v_req.sender_id, v_req.recipient_id);
    select display_name into v_name from public.profiles where id = p_actor;
    if coalesce((select notify_friend_requests from public.user_preferences where user_id = v_req.sender_id), true) then
      perform public.notify_user(v_req.sender_id, 'friend_accepted', 'Friend request accepted',
        coalesce(v_name, 'Someone') || ' accepted your request', jsonb_build_object('conversationId', v_conv, 'userId', p_actor));
    end if;
    -- Mark the original request notification as read.
    update public.notifications set read_at = now()
     where user_id = p_actor and type = 'friend_request' and data->>'requestId' = p_request::text and read_at is null;
    return jsonb_build_object('id', p_request, 'status', 'accepted', 'conversationId', v_conv);
  else
    update public.friend_requests set status = 'declined', responded_at = now() where id = p_request;
    update public.notifications set read_at = now()
     where user_id = p_actor and type = 'friend_request' and data->>'requestId' = p_request::text and read_at is null;
    return jsonb_build_object('id', p_request, 'status', 'declined');
  end if;
end $$;

create or replace function public.cancel_friend_request(p_actor uuid, p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req public.friend_requests;
begin
  select * into v_req from public.friend_requests where id = p_request for update;
  if not found or v_req.sender_id <> p_actor then
    raise exception 'not_found:Request not found' using errcode = 'P0001';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'conflict:This request was already %', v_req.status using errcode = 'P0001';
  end if;
  update public.friend_requests set status = 'cancelled', responded_at = now() where id = p_request;
  delete from public.notifications where user_id = v_req.recipient_id and type = 'friend_request'
     and data->>'requestId' = p_request::text;
  return jsonb_build_object('id', p_request, 'status', 'cancelled');
end $$;

-- Policy: unfriending keeps the existing DM history readable for both users,
-- but the conversation becomes read-only (send_dm requires friendship).
create or replace function public.remove_friend(p_actor uuid, p_other uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.friendships where user_a = least(p_actor, p_other) and user_b = greatest(p_actor, p_other);
  if not found then raise exception 'not_found:Not friends' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------
create or replace function public.block_user(p_actor uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_actor = p_target then raise exception 'bad_request:You cannot block yourself' using errcode = 'P0001'; end if;
  if not exists (select 1 from auth.users where id = p_target) then
    raise exception 'not_found:User not found' using errcode = 'P0001';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (p_actor, p_target) on conflict do nothing;
  delete from public.friendships where user_a = least(p_actor, p_target) and user_b = greatest(p_actor, p_target);
  update public.friend_requests set status = 'cancelled', responded_at = now()
   where status = 'pending' and ((sender_id = p_actor and recipient_id = p_target) or (sender_id = p_target and recipient_id = p_actor));
  delete from public.notifications where user_id = p_actor and type in ('friend_request','dm')
     and (data->>'userId' = p_target::text or data->>'senderId' = p_target::text);
end $$;

create or replace function public.unblock_user(p_actor uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_blocks where blocker_id = p_actor and blocked_id = p_target;
end $$;

-- Resolve the other participant of a session the actor took part in (for block/report).
create or replace function public.session_peer(p_actor uuid, p_session uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select o.user_id from public.random_chat_participants me
    join public.random_chat_participants o on o.session_id = me.session_id and o.user_id <> me.user_id
   where me.session_id = p_session and me.user_id = p_actor;
$$;

-- ---------------------------------------------------------------------
-- Direct messages (called by authenticated clients; identity = auth.uid())
-- ---------------------------------------------------------------------
create or replace function public.send_dm(p_conversation uuid, p_body text, p_client_id uuid)
returns public.direct_messages language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_other uuid;
  v_msg public.direct_messages;
  v_body text;
  v_name text;
  v_notif uuid;
begin
  if v_me is null then raise exception 'unauthorized:Sign in required' using errcode = 'P0001'; end if;
  -- Idempotency: return the already-stored message for a retried client id.
  select * into v_msg from public.direct_messages where sender_id = v_me and client_id = p_client_id;
  if found then
    if v_msg.conversation_id <> p_conversation then raise exception 'conflict:Duplicate client id' using errcode = 'P0001'; end if;
    return v_msg;
  end if;
  if not public.is_conversation_member(p_conversation, v_me) then
    raise exception 'not_found:Conversation not found' using errcode = 'P0001';
  end if;
  select user_id into v_other from public.direct_conversation_members
   where conversation_id = p_conversation and user_id <> v_me;
  perform public.assert_not_restricted(v_me);
  if public.is_blocked_pair(v_me, v_other) then
    raise exception 'blocked:You can no longer message this user' using errcode = 'P0001';
  end if;
  if not public.are_friends(v_me, v_other) then
    raise exception 'forbidden:You are no longer friends; this conversation is read-only' using errcode = 'P0001';
  end if;
  v_body := btrim(regexp_replace(coalesce(p_body, ''), '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]', '', 'g'));
  if char_length(v_body) = 0 then raise exception 'bad_request:Message is empty' using errcode = 'P0001'; end if;
  if char_length(v_body) > 2000 then raise exception 'bad_request:Message is too long' using errcode = 'P0001'; end if;
  if (select count(*) from public.direct_messages where sender_id = v_me and created_at > now() - interval '10 seconds') >= 15 then
    raise exception 'rate_limited:You are sending messages too quickly' using errcode = 'P0001';
  end if;
  if (select count(*) from public.direct_messages where sender_id = v_me and conversation_id = p_conversation
        and body = v_body and created_at > now() - interval '30 seconds') >= 3 then
    raise exception 'rate_limited:Please do not repeat the same message' using errcode = 'P0001';
  end if;

  insert into public.direct_messages (conversation_id, sender_id, client_id, body)
  values (p_conversation, v_me, p_client_id, v_body) returning * into v_msg;
  update public.direct_conversations set last_message_at = v_msg.created_at where id = p_conversation;
  update public.direct_conversation_members set last_read_at = v_msg.created_at
   where conversation_id = p_conversation and user_id = v_me;

  -- One coalesced unread DM notification per conversation.
  if coalesce((select notify_dms from public.user_preferences where user_id = v_other), true) then
    select display_name into v_name from public.profiles where id = v_me;
    select id into v_notif from public.notifications
     where user_id = v_other and type = 'dm' and read_at is null and data->>'conversationId' = p_conversation::text limit 1;
    if v_notif is null then
      perform public.notify_user(v_other, 'dm', 'New message', coalesce(v_name, 'A friend') || ' sent you a message',
        jsonb_build_object('conversationId', p_conversation, 'senderId', v_me));
    else
      update public.notifications set created_at = now(), body = coalesce(v_name, 'A friend') || ' sent you new messages'
       where id = v_notif;
    end if;
  end if;
  return v_msg;
end $$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.direct_conversation_members set last_read_at = now()
   where conversation_id = p_conversation and user_id = auth.uid();
  update public.notifications set read_at = now()
   where user_id = auth.uid() and type = 'dm' and read_at is null and data->>'conversationId' = p_conversation::text;
end $$;

create or replace function public.clear_conversation(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.direct_conversation_members set cleared_before = now(), last_read_at = now()
   where conversation_id = p_conversation and user_id = auth.uid();
  if not found then raise exception 'not_found:Conversation not found' using errcode = 'P0001'; end if;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
end $$;

create or replace function public.get_inbox()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t."lastMessageAt" desc nulls last), '[]'::jsonb) from (
    select c.id as "conversationId",
           o.user_id as "peerId",
           p.display_name as "peerName",
           p.avatar_seed as "peerAvatarSeed",
           p.avatar_style as "peerAvatarStyle",
           public.are_friends(auth.uid(), o.user_id) as "isFriend",
           public.is_blocked_pair(auth.uid(), o.user_id) as "isBlocked",
           c.last_message_at as "lastMessageAt",
           o.last_read_at as "peerLastReadAt",
           (select jsonb_build_object('body', left(m.body, 120), 'fromMe', m.sender_id = auth.uid(), 'createdAt', m.created_at)
              from public.direct_messages m
             where m.conversation_id = c.id and m.created_at > coalesce(me.cleared_before, '-infinity')
             order by m.created_at desc limit 1) as "lastMessage",
           (select count(*) from public.direct_messages m
             where m.conversation_id = c.id and m.sender_id <> auth.uid()
               and m.created_at > me.last_read_at and m.created_at > coalesce(me.cleared_before, '-infinity'))::int as "unread"
      from public.direct_conversation_members me
      join public.direct_conversations c on c.id = me.conversation_id
      join public.direct_conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
      left join public.profiles p on p.id = o.user_id
     where me.user_id = auth.uid()
  ) t;
$$;

create or replace function public.get_unread_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'notifications', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'dms', (select count(*) from public.direct_messages m
              join public.direct_conversation_members me on me.conversation_id = m.conversation_id and me.user_id = auth.uid()
             where m.sender_id <> auth.uid() and m.created_at > me.last_read_at
               and m.created_at > coalesce(me.cleared_before, '-infinity')),
    'friendRequests', (select count(*) from public.friend_requests where recipient_id = auth.uid() and status = 'pending')
  );
$$;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------
create or replace function public.create_report(
  p_actor uuid, p_reason text, p_details text, p_context text,
  p_session uuid default null, p_message uuid default null, p_target uuid default null, p_evidence jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_reported uuid;
  v_evidence jsonb := p_evidence;
  v_msg public.direct_messages;
  v_id uuid;
begin
  if (select count(*) from public.abuse_reports where reporter_id = p_actor and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited:Too many reports. Please try again later.' using errcode = 'P0001';
  end if;
  if p_context = 'random_chat' then
    v_reported := public.session_peer(p_actor, p_session);
    if v_reported is null then raise exception 'not_found:Chat session not found' using errcode = 'P0001'; end if;
  elsif p_context = 'dm' then
    select * into v_msg from public.direct_messages where id = p_message;
    if not found or not public.is_conversation_member(v_msg.conversation_id, p_actor) or v_msg.sender_id = p_actor then
      raise exception 'not_found:Message not found' using errcode = 'P0001';
    end if;
    v_reported := v_msg.sender_id;
    -- Only the reported message itself, nothing else from the conversation.
    v_evidence := jsonb_build_object('message', jsonb_build_object('body', v_msg.body, 'createdAt', v_msg.created_at));
  else
    v_reported := p_target;
    if v_reported is null or v_reported = p_actor then raise exception 'bad_request:Invalid target' using errcode = 'P0001'; end if;
  end if;
  insert into public.abuse_reports (reporter_id, reported_id, context, session_id, message_id, reason, details, evidence, evidence_expires_at)
  values (p_actor, v_reported, p_context, p_session, p_message, p_reason, coalesce(p_details, ''), v_evidence,
          case when v_evidence is null then null else now() + interval '90 days' end)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Moderation (Worker verifies admin role; functions re-check it)
-- ---------------------------------------------------------------------
create or replace function public.admin_restrict_user(
  p_admin uuid, p_target uuid, p_kind text, p_hours int, p_reason text, p_report uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin(p_admin) then raise exception 'forbidden:Admin role required' using errcode = 'P0001'; end if;
  if p_target = p_admin then raise exception 'bad_request:You cannot restrict yourself' using errcode = 'P0001'; end if;
  if p_kind not in ('suspend','ban') then raise exception 'bad_request:Invalid restriction' using errcode = 'P0001'; end if;
  insert into public.account_restrictions (user_id, kind, reason, ends_at, created_by)
  values (p_target, p_kind, coalesce(p_reason, ''),
          case when p_kind = 'ban' then null else now() + make_interval(hours => greatest(coalesce(p_hours, 24), 1)) end,
          p_admin)
  returning id into v_id;
  insert into public.moderation_actions (admin_id, target_user_id, report_id, action, reason, metadata)
  values (p_admin, p_target, p_report, p_kind, coalesce(p_reason, ''), jsonb_build_object('restrictionId', v_id, 'hours', p_hours));
  perform public.notify_user(p_target, 'safety', 'Account restricted',
    case when p_kind = 'ban' then 'Your account was banned for violating the Community Guidelines.'
         else 'Your account is temporarily suspended for violating the Community Guidelines.' end, '{}'::jsonb);
  return v_id;
end $$;

create or replace function public.admin_lift_restriction(p_admin uuid, p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_admin) then raise exception 'forbidden:Admin role required' using errcode = 'P0001'; end if;
  update public.account_restrictions set lifted_at = now() where user_id = p_target and lifted_at is null;
  insert into public.moderation_actions (admin_id, target_user_id, action, reason) values (p_admin, p_target, 'lift_restriction', coalesce(p_reason, ''));
end $$;

create or replace function public.admin_update_report(p_admin uuid, p_report uuid, p_status text, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if not public.is_admin(p_admin) then raise exception 'forbidden:Admin role required' using errcode = 'P0001'; end if;
  if p_status not in ('reviewing','resolved','dismissed') then raise exception 'bad_request:Invalid status' using errcode = 'P0001'; end if;
  update public.abuse_reports
     set status = p_status, resolution = coalesce(p_resolution, resolution),
         resolved_by = case when p_status in ('resolved','dismissed') then p_admin else resolved_by end,
         resolved_at = case when p_status in ('resolved','dismissed') then now() else resolved_at end
   where id = p_report returning reported_id into v_target;
  if not found then raise exception 'not_found:Report not found' using errcode = 'P0001'; end if;
  insert into public.moderation_actions (admin_id, target_user_id, report_id, action, reason)
  values (p_admin, v_target, p_report,
          case p_status when 'resolved' then 'resolve_report' when 'dismissed' then 'dismiss_report' else 'review_report' end,
          coalesce(p_resolution, ''));
end $$;

-- ---------------------------------------------------------------------
-- Privacy: export & retention
-- ---------------------------------------------------------------------
create or replace function public.export_my_data(p_actor uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'profile', (select to_jsonb(p) - 'public_gender' from public.profiles p where p.id = p_actor),
    'preferences', (select to_jsonb(u) from public.user_preferences u where u.user_id = p_actor),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('userId', case when user_a = p_actor then user_b else user_a end, 'since', created_at)), '[]')
                  from public.friendships where p_actor in (user_a, user_b)),
    'friendRequests', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.friend_requests f where p_actor in (sender_id, recipient_id)),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blockedId', blocked_id, 'at', created_at)), '[]') from public.user_blocks where blocker_id = p_actor),
    'randomChatHistory', public.get_history(p_actor, null, 50),
    'directMessagesSent', (select coalesce(jsonb_agg(jsonb_build_object('conversationId', conversation_id, 'body', body, 'at', created_at) order by created_at), '[]')
                             from public.direct_messages where sender_id = p_actor),
    'reportsFiled', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'context', context, 'status', status, 'at', created_at)), '[]')
                       from public.abuse_reports where reporter_id = p_actor),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'title', title, 'at', created_at)), '[]')
                        from public.notifications where user_id = p_actor)
  );
$$;

create or replace function public.purge_expired_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int;
begin
  delete from public.saved_random_messages where created_at < now() - interval '90 days';
  get diagnostics a = row_count;
  update public.abuse_reports set evidence = null where evidence is not null and evidence_expires_at < now();
  get diagnostics b = row_count;
  delete from public.random_chat_sessions where started_at < now() - interval '180 days';
  get diagnostics c = row_count;
  delete from public.notifications where read_at is not null and read_at < now() - interval '60 days';
  get diagnostics d = row_count;
  delete from public.safety_events where created_at < now() - interval '90 days';
  get diagnostics e = row_count;
  -- Abandoned sessions that never reported an end (crash safety).
  update public.random_chat_sessions set status = 'ENDED', ended_at = now(), end_reason = 'expired'
   where status <> 'ENDED' and started_at < now() - interval '6 hours';
  return jsonb_build_object('transcripts', a, 'evidence', b, 'sessions', c, 'notifications', d, 'safetyEvents', e);
end $$;

-- =====================================================================
-- EXECUTE privileges
-- =====================================================================
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Functions clients may call directly (identity comes from auth.uid()):
grant execute on function public.send_dm(uuid, text, uuid)           to authenticated;
grant execute on function public.mark_conversation_read(uuid)        to authenticated;
grant execute on function public.clear_conversation(uuid)            to authenticated;
grant execute on function public.mark_notifications_read(uuid[])     to authenticated;
grant execute on function public.get_inbox()                         to authenticated;
grant execute on function public.get_unread_summary()                to authenticated;
-- Helpers used inside RLS policies must be callable by the querying role:
grant execute on function public.are_friends(uuid, uuid)             to authenticated;
grant execute on function public.is_conversation_member(uuid, uuid)  to authenticated;
grant execute on function public.member_cleared_before(uuid, uuid)   to authenticated;
