# Moderation & launch readiness

## Workflow
1. Users report from a live chat (attaches up to the last 30 messages, labelled reporter/reported, no ids), from History (session metadata only), or from a DM (only that single message).
2. Reports land in `/admin` → **Reports** (`open`). A moderator opens a report and sees the reason, details, evidence (until it expires) and prior actions on the user.
3. Actions: **Mark reviewing**, **Resolve**, **Dismiss**, **Suspend (hours)**, **Ban**, **Lift restriction**. Each one writes an immutable `moderation_actions` row, and restrictions immediately evict live sessions.
4. **Suspicious activity** lists automatic `safety_events`, such as strike-based kicks for flooding.
5. **Metrics**: online, searching, in-chat, reports, sessions, average duration, match rate, average wait, socket errors.

Grant roles only via SQL (`admin_roles`). There's no UI to self-promote.

## Before an unrestricted public launch
- **Age assurance:** a self-declared 18+ checkbox doesn't keep minors out. Consider age-assurance providers, regional restrictions, and fast-tracking `suspected_minor` reports. Never present the checkbox as verification.
- **Human coverage:** staff a moderation rota with response-time targets, especially for `threats`, `sexual_misconduct` and `suspected_minor`.
- **Automated detection:** add text toxicity classification and known-harm hash matching. The current heuristics only cover spam and floods.
- **Legal:** finalise the Terms and Privacy Policy, set up a DPA with processors, cover GDPR/CCPA data-subject rights (export and delete exist), handle law-enforcement requests, and meet any online-safety regulations where you operate.
- **Abuse inbox:** monitor `abuseEmail` from `brand.ts`.
- **Incident response:** have a key-rotation plan (`ROOM_TOKEN_SECRET`, Supabase secret key) and ban-evasion monitoring.
