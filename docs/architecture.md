# Architecture

```
 Browser (React SPA on Cloudflare Pages)
   │  HTTPS  REST  /api/*  (Bearer = Supabase access token)
   │  WSS    /ws/lobby?ticket=…   (single-use 30s ticket)
   │  WSS    /ws/room/:id?token=… (HMAC room token, single-use nonce, 60s)
   │  Supabase JS: Auth, DMs (RLS), notifications, Realtime (RLS-filtered)
   ▼
 Cloudflare Worker (apps/worker)
   ├─ REST routes ──► Supabase PostgREST (secret key) ──► SECURITY DEFINER SQL functions
   ├─ MatchCoordinator DO  ("global")   lobby sockets, presence, FIFO queue, tickets
   └─ ChatRoom DO          (1 per match) chat relay, typing, grace, save-consent, quest, reports
 Supabase
   ├─ Postgres + RLS (supabase/migrations)
   ├─ Auth: anonymous + Google (PKCE), manual identity linking
   └─ Realtime: postgres_changes (RLS) + private broadcast channels (DM typing)
```

## Why two sockets?
The **lobby** socket is long-lived while the user is in the app. It provides presence (who is online), queue status, and match notifications, and it lets the user *resume* a room after a refresh. The **room** socket is per conversation and terminates at that room's own Durable Object. That keeps chat traffic off the global coordinator and lets rooms scale horizontally.

## Matching algorithm (gender-blind, first available)
Implemented in `apps/worker/src/matchmaking/engine.ts` (pure, no I/O) and wrapped by `coordinator.ts`.

1. `queue:join` → the engine marks the user `MATCHING` and scans the queue oldest-first.
2. A candidate is skipped and pruned if they are disconnected, stale (no heartbeat for 65s), or not `QUEUED`.
3. A candidate is skipped (but kept) if either user has blocked the other.
4. The first eligible candidate is paired atomically. Both become `MATCHED` with the same `roomId`. If there's no candidate, the user is appended to the queue.
5. `MatchProfile` contains only display name and avatar. **There is no demographic field the engine could use.** A test asserts the engine and coordinator sources never mention gender.

**Atomicity.** A Durable Object runs each event to completion on one thread, and `join()` is synchronous. Two concurrent arrivals are therefore serialised and can't claim the same waiting user. After the room DO is created (an `await`), the coordinator re-verifies both users are still assigned to that room before sending `queue:matched`.

**State model.** Users move through `IDLE`, `QUEUED`, `MATCHING` (transient), `MATCHED` and `DISCONNECTED`. Sessions move through `CREATING`, `ACTIVE`, `RECONNECTING` and `ENDED`. Each user has at most one queue entry and one active session.

**Next Stranger.** `queue:next` is handled by the coordinator in one step: it releases the room (`endRoom`), tells the room DO to end (the room notifies the peer with `chat:ended {by:'peer'}`), then calls `join()` again. The client guards against double taps, and the server enforces a minimum 1.2s gap plus a sliding-window limit.

## Reconnection
- Heartbeats run every 20s on both sockets. A socket that's silent for more than 45s is closed client-side and reopened. Visibility, online and pageshow events trigger an immediate check, which handles device sleep and network switches.
- Lobby reconnect uses exponential backoff with a fresh ticket each time (tickets are single-use).
- If a room socket drops, the room enters `RECONNECTING` and the peer sees "Stranger reconnecting…". The client asks the coordinator (`session:resume`) for a fresh room token. If it rejoins within **30s**, the room sends `chat:ready` with the buffered messages, and any unacknowledged sends are retried with the same `clientMsgId`, so there are no duplicates.
- After the grace period the room ends with `timeout` and the client shows the conversation as ended. The UI never shows *Connected* unless the server has confirmed `chat:ready` and the socket is open.
- Browser refresh works the same way: on connect, the lobby `hello` carries `activeSessionId` and the client resumes.
- Server restarts and DO eviction: coordinator entries and tickets are persisted per user in DO storage, and live sockets are re-counted from hibernation attachments. Room meta and the message buffer are persisted per key. Alarms enforce grace periods and clean up ended rooms (a 10-minute tombstone, then `deleteAll`).

## Protocol
All payload types and validators are in `packages/shared/src/schemas/protocol.ts`. The server derives sender identity from the authenticated socket. Client frames are strictly validated: unknown or extra fields are rejected and frames are capped at 8 KB.

## REST API
| Method & path | Purpose |
|---|---|
| `GET/PATCH/DELETE /api/me`, `GET /api/me/export` | Profile, preferences, onboarding, deletion, export |
| `GET /api/profiles/:id` | Friend-only public profile |
| `GET /api/friends`, `DELETE /api/friends/:userId` | Friends |
| `GET/POST /api/friend-requests`, `POST …/:id/accept`, `POST …/:id/decline`, `DELETE …/:id` | Requests (session-based, no public search) |
| `GET /api/history`, `GET/DELETE /api/history/:id`, `DELETE /api/history/:id/transcript` | Random-chat history and consented transcripts |
| `POST /api/reports`, `GET/POST /api/blocks`, `DELETE /api/blocks/:userId` | Safety |
| `GET /api/presence/count` (public), `GET /api/presence/friends` | Presence |
| `POST /api/realtime-ticket` | Lobby WebSocket ticket |
| `/api/admin/*` | Moderation (server-verified admin role) |

Errors use the shape `{ error: { code, message, field?, retryAfterMs? } }` with correct status codes. Pagination is cursor-based (`?before=<ISO timestamp>`).

DMs and notifications go through the Supabase client: RLS-protected `select` plus SECURITY DEFINER RPCs that use `auth.uid()`, so they aren't duplicated behind the Worker.

## Presence definition
"Online" means the user has at least one open lobby socket with a heartbeat in the last 65s. Counts are approximate and broadcast about every 15s. A friend's status shows only if they enabled *show online status* and the relationship isn't blocked (blocking deletes the friendship, so blocked users never receive presence).

## Scaling limits and sharding plan
- **V1:** a single `MatchCoordinator` DO handles lobby sockets for everyone. One DO is single-threaded, which is practical up to a few thousand concurrent lobby sockets and a modest rate of joins per second. Room traffic doesn't touch it.
- **Next steps:**
  1. Split presence from matching: shard lobby sockets across N `LobbyShard` DOs by `hash(userId) % N`, and send only queue operations to the matcher.
  2. Shard the matcher into K queue shards with a work-stealing step. A user joins shard `hash(userId) % K`, and if that shard is empty, the coordinator probes other shards' heads. This keeps first-available semantics approximately, **without** adding geographic or demographic restrictions.
  3. Use `locationHint`s to place shards near users (latency only, never eligibility).
- Cost: hibernatable sockets and per-message storage writes in rooms dominate DO usage. Monitor DO duration and rows written.
