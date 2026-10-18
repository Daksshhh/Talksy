# Security notes

## Identity & sessions
- Supabase Auth issues JWTs. The Worker verifies them (`apps/worker/src/auth/jwt.ts`) using the project **JWKS** (ES256/RS256/EdDSA, cached 10 min). Legacy **HS256** tokens are verified with `SUPABASE_JWT_SECRET`, or remotely via `/auth/v1/user` if that isn't set. The Worker checks `exp`, `iss`, `role=authenticated` and `aud`, and rejects `alg=none` and unknown `kid`s.
- Guests get real anonymous Supabase users with the same RLS as everyone else.
- The browser only ever holds the **publishable** key. The **secret** key exists only in Worker secrets, and `sb_secret_` keys are sent only in the `apikey` header.

## WebSockets
- Browsers can't set `Authorization` headers on WebSockets, so `POST /api/realtime-ticket` (Bearer JWT) issues a **32-byte random, single-use ticket that expires in 30s**. The coordinator consumes it with get+delete inside one DO turn, so reused, expired or unknown tickets get a 401. Long-lived tokens never appear in URLs.
- Room sockets use HMAC-SHA256 **room tokens** bound to (room, user) with a 60s expiry and a **single-use nonce** recorded by the room.
- Every upgrade checks `Origin` against `CLIENT_ORIGIN` (403 otherwise). Identity headers to the room DO are created by the Worker. Client-supplied headers are not forwarded.
- Client frames: strict parsing, 8 KB cap, unknown or extra keys rejected, so a forged `senderId`/`userId` field is refused. Sender identity always comes from the socket attachment.
- Bans: ticket issuance checks restrictions, and admin restriction **evicts** live sockets and ends rooms. Blocks are loaded into the matcher on every ticket and pushed live via `/internal/block`.

## Database
- RLS is enabled on **every** table. Clients can only `select` their own rows, or rows they participate in. All `insert/update/delete` privileges are revoked from `anon`/`authenticated`.
- Mutations go through SECURITY DEFINER functions:
  - **Client-callable** (`send_dm`, `mark_*`, `get_inbox`, `get_unread_summary`, `clear_conversation`) take identity from `auth.uid()` only.
  - **Service-only** (friend requests, blocks, reports, sessions, admin) take a Worker-verified `p_actor`. `EXECUTE` is revoked from `public/anon/authenticated`.
- DM access: changing a conversation id is useless. RLS (`is_conversation_member`) and `send_dm` both check membership.
- Admin: `admin_roles` has no client policies and no client privileges. The Worker checks `is_admin` server-side, and admin SQL functions re-check it. `moderation_actions` is append-only (trigger).
- Uniqueness and transitions: canonical friendship ordering (`user_a < user_b`), a single pending request per pair (partial unique index), a status-transition trigger, idempotent DMs (`unique(sender_id, client_id)`).

## Abuse controls
- Rate limits: tickets (20/min), queue joins (25/min), Next (1.2s minimum gap and 40 per 5 min), messages (8 per 5s), typing, quest actions, save requests, REST writes per isolate (60/min, approximate), and DB-enforced limits on friend requests (30/h), DMs (15/10s), and reports (10/h).
- Flood detection (normalised duplicate text), a link cap (3 per message), non-clickable links in stranger chat, and strike-based kicks with `safety_events`.
- Friend-request cooldown of 72h after a decline.
- Optional Turnstile on guest sign-in (Supabase CAPTCHA) and on tickets for anonymous users (`REQUIRE_TURNSTILE=true`).

## Web
- React escapes all text. No `dangerouslySetInnerHTML` anywhere.
- `_headers`: CSP, `frame-ancestors 'none'`, nosniff, HSTS, Permissions-Policy.
- The OAuth callback only follows same-site relative `next` paths, which prevents open redirects.

## Logging & privacy
Structured JSON logs. They never include message bodies, tokens, emails or IPs, and user ids are truncated to 8 characters. Room buffers are deleted when a room ends. See `moderation.md` for retention.

## Known gaps / future hardening
- The per-isolate REST limiter is approximate. Use Cloudflare Rate Limiting rules or a DO-based limiter for strict global limits.
- No automated content classifier (toxicity, CSAM hashing). Integrate one before scale.
- Age is self-declared.
