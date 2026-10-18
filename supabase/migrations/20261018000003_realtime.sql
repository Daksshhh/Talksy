-- =====================================================================
-- Realtime configuration
-- Postgres Changes respect RLS for the subscribing user, so clients only
-- receive rows they are allowed to SELECT (own notifications, own DMs...).
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.friend_requests;
alter publication supabase_realtime add table public.direct_conversation_members;
alter publication supabase_realtime add table public.friendships;

-- Needed so UPDATE/DELETE events carry enough data for RLS evaluation & filters.
alter table public.direct_conversation_members replica identity full;
alter table public.friendships replica identity full;
alter table public.friend_requests replica identity full;

-- ---------------------------------------------------------------------
-- Private broadcast channels for DM typing indicators: topic = 'dm:<conversation uuid>'.
-- Only conversation members may send/receive on the channel.
-- (Requires "Realtime > Settings > Private channels only" or private: true on the client.)
-- ---------------------------------------------------------------------
create or replace function public.realtime_topic_conversation(p_topic text) returns uuid
language plpgsql immutable as $$
begin
  if p_topic !~ '^dm:[0-9a-fA-F-]{36}$' then return null; end if;
  return substr(p_topic, 4)::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.realtime_topic_conversation(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    execute $p$
      create policy "dm members can receive typing" on realtime.messages for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and public.is_conversation_member(public.realtime_topic_conversation(realtime.topic()), (select auth.uid()))
      )$p$;
    execute $p$
      create policy "dm members can send typing" on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension = 'broadcast'
        and public.is_conversation_member(public.realtime_topic_conversation(realtime.topic()), (select auth.uid()))
      )$p$;
  end if;
end $$;
