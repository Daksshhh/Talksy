-- =====================================================================
-- OrbitChat - initial schema
-- Identity: Supabase Auth (auth.users). Every user-owned table has RLS.
-- Privileged writes happen through SECURITY DEFINER functions that are
-- executable ONLY by service_role (the Worker), taking a verified actor id,
-- or by `authenticated` using auth.uid() (never a client-supplied id).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Profiles (public-ish data; readable by self and friends only)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  public_id     text not null unique default ('orb_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  display_name  text not null check (char_length(display_name) between 2 and 24),
  avatar_seed   text not null default substr(md5(random()::text), 1, 12) check (avatar_seed ~ '^[A-Za-z0-9]{4,16}$'),
  avatar_style  text not null default 'orbit' check (avatar_style in ('orbit','nebula','comet','aurora','pulse','prism')),
  bio           text not null default '' check (char_length(bio) <= 280),
  interests     text[] not null default '{}' check (cardinality(interests) <= 8),
  language      text not null default 'en' check (char_length(language) between 2 and 10),
  -- Derived from user_preferences: null unless the user chose to show gender.
  public_gender text check (public_gender in ('male','female','non_binary','prefer_not_to_say')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Private per-user settings. Gender lives here (never used for matching).
create table public.user_preferences (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  gender                 text not null default 'prefer_not_to_say' check (gender in ('male','female','non_binary','prefer_not_to_say')),
  show_gender            boolean not null default false,
  show_online            boolean not null default true,
  allow_match_requests   boolean not null default true,
  notify_friend_requests boolean not null default true,
  notify_dms             boolean not null default true,
  age_confirmed_at       timestamptz,
  terms_accepted_at      timestamptz,
  terms_version          text,
  onboarded_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger prefs_touch before update on public.user_preferences for each row execute function public.touch_updated_at();

create or replace function public.sync_public_gender() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set public_gender = case when new.show_gender then new.gender else null end
   where id = new.user_id;
  return new;
end $$;
create trigger prefs_sync_gender after insert or update of gender, show_gender on public.user_preferences
  for each row execute function public.sync_public_gender();

-- Create profile + preferences for every new auth user (guest or Google).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  adjectives text[] := array['Cosmic','Lunar','Solar','Swift','Quiet','Bright','Curious','Gentle','Nova','Stellar','Misty','Velvet','Amber','Azure','Coral','Jade'];
  nouns      text[] := array['Otter','Falcon','Comet','Panda','Fox','Koala','Orbit','Lynx','Heron','Wave','Pixel','Maple','Echo','Sparrow','Nebula','Tiger'];
  nick text;
begin
  nick := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
       || nouns[1 + floor(random() * array_length(nouns, 1))::int]
       || (10 + floor(random() * 90))::int::text;
  insert into public.profiles (id, display_name) values (new.id, nick) on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Roles, restrictions, blocks
-- ---------------------------------------------------------------------
create table public.admin_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('moderator','admin')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.account_restrictions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('suspend','ban')),
  reason     text not null default '' check (char_length(reason) <= 500),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,            -- null = permanent (ban)
  lifted_at  timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index account_restrictions_user_idx on public.account_restrictions (user_id) where lifted_at is null;

create table public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

create or replace function public.is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_roles where user_id = p_user);
$$;

create or replace function public.active_restriction(p_user uuid)
returns table (kind text, ends_at timestamptz, reason text)
language sql stable security definer set search_path = public as $$
  select r.kind, r.ends_at, r.reason
    from public.account_restrictions r
   where r.user_id = p_user and r.lifted_at is null and r.starts_at <= now()
     and (r.ends_at is null or r.ends_at > now())
   order by (r.kind = 'ban') desc, r.ends_at desc nulls first
   limit 1;
$$;

create or replace function public.is_blocked_pair(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- ---------------------------------------------------------------------
-- Random chat sessions (metadata only) + consented transcripts
-- ---------------------------------------------------------------------
create table public.random_chat_sessions (
  id          uuid primary key,
  status      text not null default 'CREATING' check (status in ('CREATING','ACTIVE','RECONNECTING','ENDED')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  end_reason  text,
  created_at  timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index random_chat_sessions_started_idx on public.random_chat_sessions (started_at desc);

create table public.random_chat_participants (
  session_id    uuid not null references public.random_chat_sessions(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null,          -- anonymous name at the time
  avatar_seed   text not null default '',
  hidden_at     timestamptz,            -- user removed it from their history
  primary key (session_id, user_id)
);
create index random_chat_participants_user_idx on public.random_chat_participants (user_id, session_id);

create table public.conversation_save_consents (
  session_id   uuid not null references public.random_chat_sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  consented_at timestamptz not null default now(),
  revoked_at   timestamptz,
  primary key (session_id, user_id)
);

create table public.saved_random_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.random_chat_sessions(id) on delete cascade,
  seq        int  not null,
  sender_id  uuid references auth.users(id) on delete set null,
  body       text not null check (char_length(body) between 1 and 1000),
  sent_at    timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create table public.conversation_quest_sessions (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.random_chat_sessions(id) on delete cascade,
  category         text not null,
  rounds_completed int not null default 0 check (rounds_completed >= 0),
  started_at       timestamptz not null,
  ended_at         timestamptz not null default now()
);
create index quest_sessions_session_idx on public.conversation_quest_sessions (session_id);
-- Quest ANSWERS are intentionally not persisted (privacy); state lives in the room only.

-- ---------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------
create table public.friendships (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)          -- canonical order => unique regardless of order
);
create index friendships_b_idx on public.friendships (user_b);

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships where user_a = least(a, b) and user_b = greatest(a, b));
$$;

create table public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  session_id   uuid references public.random_chat_sessions(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
-- At most one pending request per pair, in either direction.
create unique index friend_requests_one_pending_idx
  on public.friend_requests (least(sender_id, recipient_id), greatest(sender_id, recipient_id))
  where status = 'pending';
create index friend_requests_recipient_idx on public.friend_requests (recipient_id, status, created_at desc);
create index friend_requests_sender_idx on public.friend_requests (sender_id, status, created_at desc);
create trigger friend_requests_touch before update on public.friend_requests for each row execute function public.touch_updated_at();

create or replace function public.enforce_friend_request_transition() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status and old.status <> 'pending' then
    raise exception 'conflict:This request was already %', old.status using errcode = 'P0001';
  end if;
  if new.sender_id <> old.sender_id or new.recipient_id <> old.recipient_id then
    raise exception 'forbidden:Participants cannot change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger friend_requests_transition before update on public.friend_requests
  for each row execute function public.enforce_friend_request_transition();

-- ---------------------------------------------------------------------
-- Direct messages
-- ---------------------------------------------------------------------
create table public.direct_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references auth.users(id) on delete cascade,
  user_b          uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.direct_conversation_members (
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  cleared_before  timestamptz,            -- "delete my copy": hide older messages for this user
  primary key (conversation_id, user_id)
);
create index dcm_user_idx on public.direct_conversation_members (user_id);

create table public.direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id       uuid not null references auth.users(id) on delete cascade,
  client_id       uuid not null,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now(),
  unique (sender_id, client_id)      -- idempotent retries
);
create index direct_messages_conv_idx on public.direct_messages (conversation_id, created_at desc, id desc);

create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.direct_conversation_members
                  where conversation_id = p_conversation and user_id = p_user);
$$;

create or replace function public.member_cleared_before(p_conversation uuid, p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select cleared_before from public.direct_conversation_members
   where conversation_id = p_conversation and user_id = p_user;
$$;

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('friend_request','friend_accepted','dm','safety','system')),
  title      text not null,
  body       text not null default '',
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------
-- Safety & moderation
-- ---------------------------------------------------------------------
create table public.abuse_reports (
  id                  uuid primary key default gen_random_uuid(),
  reporter_id         uuid references auth.users(id) on delete set null,
  reported_id         uuid references auth.users(id) on delete set null,
  context             text not null check (context in ('random_chat','dm','profile')),
  session_id          uuid references public.random_chat_sessions(id) on delete set null,
  message_id          uuid references public.direct_messages(id) on delete set null,
  reason              text not null check (reason in ('harassment','hate','spam','sexual_misconduct','threats','suspected_minor','other')),
  details             text not null default '' check (char_length(details) <= 1000),
  evidence            jsonb,                 -- minimal, purged after retention window
  evidence_expires_at timestamptz,
  status              text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  resolution          text,
  resolved_by         uuid references auth.users(id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index abuse_reports_status_idx on public.abuse_reports (status, created_at desc);
create index abuse_reports_reported_idx on public.abuse_reports (reported_id, created_at desc);

create table public.moderation_actions (   -- append-only audit log
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  report_id      uuid references public.abuse_reports(id) on delete set null,
  action         text not null check (action in ('suspend','ban','lift_restriction','resolve_report','dismiss_report','review_report','warn')),
  reason         text not null default '',
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index moderation_actions_created_idx on public.moderation_actions (created_at desc);

create or replace function public.prevent_audit_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'forbidden:moderation_actions is append-only' using errcode = 'P0001';
end $$;
create trigger moderation_actions_immutable before update or delete on public.moderation_actions
  for each row when (pg_trigger_depth() = 0 and current_setting('orbit.allow_audit_cleanup', true) is distinct from 'on')
  execute function public.prevent_audit_mutation();

create table public.safety_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  session_id uuid,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index safety_events_created_idx on public.safety_events (created_at desc);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles                    enable row level security;
alter table public.user_preferences            enable row level security;
alter table public.admin_roles                 enable row level security;
alter table public.account_restrictions        enable row level security;
alter table public.user_blocks                 enable row level security;
alter table public.random_chat_sessions        enable row level security;
alter table public.random_chat_participants    enable row level security;
alter table public.conversation_save_consents  enable row level security;
alter table public.saved_random_messages       enable row level security;
alter table public.conversation_quest_sessions enable row level security;
alter table public.friendships                 enable row level security;
alter table public.friend_requests             enable row level security;
alter table public.direct_conversations        enable row level security;
alter table public.direct_conversation_members enable row level security;
alter table public.direct_messages             enable row level security;
alter table public.notifications               enable row level security;
alter table public.abuse_reports               enable row level security;
alter table public.moderation_actions          enable row level security;
alter table public.safety_events               enable row level security;

-- Clients may only READ their own / authorized rows. All writes go through
-- SECURITY DEFINER functions or the Worker (service role). Tables without a
-- policy below are completely inaccessible to anon/authenticated clients.
create policy profiles_read_self_or_friend on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.are_friends((select auth.uid()), id));

create policy prefs_read_self on public.user_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy blocks_read_own on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy friendships_read_own on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create policy friend_requests_read_own on public.friend_requests for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));

create policy conversations_read_member on public.direct_conversations for select to authenticated
  using (public.is_conversation_member(id, (select auth.uid())));

create policy conv_members_read_member on public.direct_conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id, (select auth.uid())));

create policy dms_read_member on public.direct_messages for select to authenticated
  using (
    public.is_conversation_member(conversation_id, (select auth.uid()))
    and created_at > coalesce(public.member_cleared_before(conversation_id, (select auth.uid())), '-infinity'::timestamptz)
  );

create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Belt and braces: remove direct write privileges from client roles.
revoke insert, update, delete on all tables in schema public from anon, authenticated;
revoke all on public.admin_roles, public.account_restrictions, public.abuse_reports,
              public.moderation_actions, public.safety_events, public.saved_random_messages,
              public.conversation_save_consents, public.random_chat_participants,
              public.random_chat_sessions, public.conversation_quest_sessions
  from anon, authenticated;
revoke all on all tables in schema public from anon;
