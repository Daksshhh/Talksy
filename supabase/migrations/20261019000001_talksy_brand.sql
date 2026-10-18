-- Use the Talksy prefix for newly generated public profile IDs.
-- Existing public IDs remain valid and unchanged.
alter table public.profiles
  alter column public_id set default ('talk_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
