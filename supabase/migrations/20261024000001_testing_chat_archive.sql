-- Temporary testing archive for random-chat message content.
-- Remove this table and the Worker archive_message effect before scaling.
-- Normal authenticated users have no access; only the service role / dashboard can read it.

create table public.testing_random_chat_messages (
  message_id          uuid primary key,
  session_id          uuid not null references public.random_chat_sessions(id) on delete cascade,
  seq                 int not null check (seq > 0),
  sender_id           uuid references auth.users(id) on delete set null,
  sender_display_name text not null,
  body                text not null check (char_length(body) between 1 and 1000),
  sent_at             timestamptz not null,
  captured_at         timestamptz not null default now(),
  unique (session_id, seq)
);

create index testing_random_chat_messages_session_idx
  on public.testing_random_chat_messages (session_id, seq);
create index testing_random_chat_messages_sent_idx
  on public.testing_random_chat_messages (sent_at desc);

alter table public.testing_random_chat_messages enable row level security;
revoke all on table public.testing_random_chat_messages from public, anon, authenticated;
grant all on table public.testing_random_chat_messages to service_role;

comment on table public.testing_random_chat_messages is
  'Temporary, admin-only random-chat archive for initial product testing; purged after 30 days.';

create or replace function public.purge_expired_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int; c int; d int; e int; f int;
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
  delete from public.testing_random_chat_messages where captured_at < now() - interval '30 days';
  get diagnostics f = row_count;
  update public.random_chat_sessions set status = 'ENDED', ended_at = now(), end_reason = 'expired'
   where status <> 'ENDED' and started_at < now() - interval '6 hours';
  return jsonb_build_object(
    'transcripts', a,
    'evidence', b,
    'sessions', c,
    'notifications', d,
    'safetyEvents', e,
    'testingChatMessages', f
  );
end $$;

revoke execute on function public.purge_expired_data() from public, anon, authenticated;
grant execute on function public.purge_expired_data() to service_role;

-- Example dashboard query:
-- select sent_at, session_id, sender_display_name, body
-- from public.testing_random_chat_messages
-- order by sent_at desc;

-- Direct messages are already stored in public.direct_messages.
-- This table intentionally covers random-chat messages only.
-- It contains no recipient copy because the session identifies both participants.
-- The unique keys make Worker retries idempotent.
