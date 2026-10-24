# Database

Migrations live in `supabase/migrations/`:
1. `…01_init_schema.sql`: tables, indexes, triggers, RLS policies, privilege revokes
2. `…02_functions.sql`: atomic business functions and EXECUTE grants
3. `…03_realtime.sql`: publication and private-channel policies

| Table | Purpose |
|---|---|
| `profiles` | Display name, avatar, bio, interests, language, `public_gender` (derived; null when hidden). Readable by self and friends |
| `user_preferences` | Private gender, privacy and notification toggles, 18+ / terms timestamps, onboarding |
| `friend_requests` | `pending → accepted/declined/cancelled`; one pending per pair; tied to the originating session |
| `friendships` | Canonical pair `(user_a < user_b)` |
| `direct_conversations`, `direct_conversation_members`, `direct_messages` | DMs with `last_read_at` (read receipts) and `cleared_before` ("delete my copy") |
| `random_chat_sessions`, `random_chat_participants` | Metadata-only history (nickname snapshot, timing, end reason) |
| `conversation_save_consents`, `saved_random_messages` | Transcripts, only with both participants' consent |
| `conversation_quest_sessions` | Quest category and rounds (answers are **not** stored) |
| `testing_random_chat_messages` | Temporary admin-only archive of every accepted random-chat message for initial testing |
| `notifications` | Per-user notifications (Realtime) |
| `user_blocks`, `abuse_reports`, `moderation_actions`, `account_restrictions`, `admin_roles`, `safety_events` | Safety and moderation |

`conversation_quest_answers` from the original brief was deliberately consolidated away for privacy, since answers live only in the room DO.

## Policies on unfriend & block
- **Unfriend:** existing DMs stay readable for both users, but the conversation becomes read-only (`send_dm` requires friendship).
- **Block:** removes the friendship, cancels pending requests, deletes related notifications, prevents DMs, requests and matches, and hides presence.
- **Account deletion:** cascades from `auth.users`. Reports keep `null` user references for audit purposes.

## Retention (`purge_expired_data()`, daily via Worker cron)
| Data | Retention |
|---|---|
| Saved transcripts | 90 days, or until both participants revoke access |
| Report evidence | 90 days (`evidence` set to null) |
| Testing random-chat archive | 30 days |
| Random-chat metadata | 180 days |
| Read notifications | 60 days |
| Safety events | 90 days |
| Sessions stuck in non-ENDED state | Closed after 6h |

## Seed strategy
Production has **no seed data**. All stats and chats are real. `supabase/seed.sql` only documents how to grant an admin role. Quest content ships in code (`packages/quest-content`).

## Pagination
Cursor-based: DMs and history use `created_at`/`started_at` as the `before` cursor. Indexes cover `(conversation_id, created_at desc)`, `(user_id, session_id)`, and `(recipient_id, status, created_at)`.
