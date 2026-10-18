import { isPlainObject, isUuid, sanitizeText, type AdminMetrics, type AdminReport } from '@orbit/shared';
import type { Ctx } from '../router';
import { db, requireAdmin, requireUser } from '../middleware/auth';
import { badRequest, json, notFound, readJson } from '../http';
import { coordinator } from '../services/coordinator';
import { log, shortId } from '../services/logger';

/**
 * Moderation API. Every handler verifies the caller's JWT AND the server-side
 * admin_roles table (not a client flag). The SQL functions re-check the role.
 */
async function admin(ctx: Ctx) {
  const user = await requireUser(ctx.req, ctx.env);
  const d = db(ctx.env);
  await requireAdmin(d, user.id);
  return { user, d };
}

interface ReportRow {
  id: string;
  created_at: string;
  status: AdminReport['status'];
  reason: AdminReport['reason'];
  context: string;
  details: string;
  reporter_id: string | null;
  reported_id: string | null;
  session_id: string | null;
  message_id: string | null;
  evidence: unknown;
  evidence_expires_at: string | null;
  resolution: string | null;
}

async function hydrate(ctx: Ctx, rows: ReportRow[], withEvidence: boolean): Promise<AdminReport[]> {
  const d = db(ctx.env);
  const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.reported_id]).filter((x): x is string => !!x))];
  const profiles = ids.length
    ? await d.select<{ id: string; display_name: string }>('profiles', `select=id,display_name&id=in.(${ids.join(',')})`)
    : [];
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const reportedIds = [...new Set(rows.map((r) => r.reported_id).filter((x): x is string => !!x))];
  const open = reportedIds.length
    ? await d.select<{ reported_id: string }>('abuse_reports', `select=reported_id&status=in.(open,reviewing)&reported_id=in.(${reportedIds.join(',')})`)
    : [];
  const restr = reportedIds.length
    ? await d.select<{ user_id: string; kind: string }>(
        'account_restrictions',
        `select=user_id,kind&lifted_at=is.null&user_id=in.(${reportedIds.join(',')})&or=(ends_at.is.null,ends_at.gt.${new Date().toISOString()})`,
      )
    : [];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    reason: r.reason,
    context: r.context,
    details: r.details,
    reporter: { id: r.reporter_id ?? '', displayName: names.get(r.reporter_id ?? '') ?? 'Deleted user' },
    reported: {
      id: r.reported_id ?? '',
      displayName: names.get(r.reported_id ?? '') ?? 'Deleted user',
      openReports: open.filter((o) => o.reported_id === r.reported_id).length,
      restriction: restr.find((x) => x.user_id === r.reported_id)?.kind ?? null,
    },
    sessionId: r.session_id,
    messageId: r.message_id,
    evidence: withEvidence ? r.evidence : undefined,
    evidenceExpiresAt: r.evidence_expires_at,
    resolution: r.resolution,
  }));
}

export async function listReports(ctx: Ctx): Promise<Response> {
  const { d } = await admin(ctx);
  const status = ctx.url.searchParams.get('status') ?? 'open';
  if (!['open', 'reviewing', 'resolved', 'dismissed', 'all'].includes(status)) throw badRequest('Invalid status');
  const before = ctx.url.searchParams.get('before');
  let q = 'select=id,created_at,status,reason,context,details,reporter_id,reported_id,session_id,message_id,evidence_expires_at,resolution,evidence&order=created_at.desc&limit=50';
  if (status !== 'all') q += `&status=eq.${status}`;
  if (before && !Number.isNaN(Date.parse(before))) q += `&created_at=lt.${encodeURIComponent(before)}`;
  const rows = await d.select<ReportRow>('abuse_reports', q);
  const items = await hydrate(ctx, rows, false);
  return json({ items, nextCursor: rows.length === 50 ? rows[rows.length - 1].created_at : null });
}

export async function getReport(ctx: Ctx): Promise<Response> {
  const { d, user } = await admin(ctx);
  if (!isUuid(ctx.params.id)) throw badRequest('Invalid id');
  const row = await d.selectOne<ReportRow>('abuse_reports', `select=*&id=eq.${ctx.params.id}`);
  if (!row) throw notFound();
  log('info', 'admin_view_report', { admin: shortId(user.id), report: shortId(row.id) });
  const [item] = await hydrate(ctx, [row], true);
  const history = row.reported_id
    ? await d.select('moderation_actions', `select=action,reason,created_at&target_user_id=eq.${row.reported_id}&order=created_at.desc&limit=20`)
    : [];
  return json({ ...item, targetHistory: history });
}

export async function updateReport(ctx: Ctx): Promise<Response> {
  const { d, user } = await admin(ctx);
  if (!isUuid(ctx.params.id)) throw badRequest('Invalid id');
  const body = await readJson(ctx.req);
  if (!isPlainObject(body)) throw badRequest('Invalid body');
  const status = body.status;
  if (status !== 'reviewing' && status !== 'resolved' && status !== 'dismissed') throw badRequest('Invalid status', 'status');
  const res = sanitizeText(body.resolution ?? '', 500, { allowEmpty: true });
  if (!res.ok) throw badRequest('Resolution too long', 'resolution');
  await d.rpc('admin_update_report', { p_admin: user.id, p_report: ctx.params.id, p_status: status, p_resolution: res.value });
  return json({ ok: true });
}

export async function restrictUser(ctx: Ctx): Promise<Response> {
  const { d, user } = await admin(ctx);
  const target = ctx.params.userId;
  if (!isUuid(target)) throw badRequest('Invalid user id');
  const body = await readJson(ctx.req);
  if (!isPlainObject(body)) throw badRequest('Invalid body');
  const kind = body.kind;
  if (kind !== 'suspend' && kind !== 'ban') throw badRequest('kind must be suspend or ban', 'kind');
  const hours = typeof body.hours === 'number' ? Math.min(Math.max(Math.round(body.hours), 1), 24 * 365) : 24;
  const reason = sanitizeText(body.reason ?? '', 500, { allowEmpty: true });
  if (!reason.ok) throw badRequest('Reason too long', 'reason');
  const reportId = isUuid(body.reportId) ? body.reportId : null;
  const id = await d.rpc<string>('admin_restrict_user', { p_admin: user.id, p_target: target, p_kind: kind, p_hours: hours, p_reason: reason.value, p_report: reportId });
  // Kick live sessions immediately.
  await coordinator(ctx.env)
    .fetch('https://coord/internal/evict', { method: 'POST', body: JSON.stringify({ userId: target, reason: 'Your account has been restricted.' }) })
    .catch(() => undefined);
  log('info', 'admin_restrict', { admin: shortId(user.id), target: shortId(target), kind });
  return json({ id }, 201);
}

export async function liftRestriction(ctx: Ctx): Promise<Response> {
  const { d, user } = await admin(ctx);
  if (!isUuid(ctx.params.userId)) throw badRequest('Invalid user id');
  const body = await readJson(ctx.req);
  const reason = isPlainObject(body) && typeof body.reason === 'string' ? body.reason.slice(0, 500) : '';
  await d.rpc('admin_lift_restriction', { p_admin: user.id, p_target: ctx.params.userId, p_reason: reason });
  return json({ ok: true });
}

export async function listActions(ctx: Ctx): Promise<Response> {
  const { d } = await admin(ctx);
  const rows = await d.select<{ admin_id: string | null; target_user_id: string | null; action: string; reason: string; created_at: string; report_id: string | null }>(
    'moderation_actions',
    'select=admin_id,target_user_id,action,reason,created_at,report_id&order=created_at.desc&limit=100',
  );
  return json({ items: rows });
}

export async function listSafetyEvents(ctx: Ctx): Promise<Response> {
  const { d } = await admin(ctx);
  const rows = await d.select('safety_events', 'select=id,user_id,session_id,kind,detail,created_at&order=created_at.desc&limit=100');
  return json({ items: rows });
}

export async function metrics(ctx: Ctx): Promise<Response> {
  const { d } = await admin(ctx);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [stats, reportsOpen, reports24h, sessions24h, activeRestrictions, safety24h, recentSessions] = await Promise.all([
    coordinator(ctx.env).fetch('https://coord/internal/stats').then((r) => r.json() as Promise<{ online: number; waiting: number; inChat: number; metrics: AdminMetrics['matchStats'] }>),
    d.count('abuse_reports', 'status=in.(open,reviewing)'),
    d.count('abuse_reports', `created_at=gt.${since}`),
    d.count('random_chat_sessions', `started_at=gt.${since}`),
    d.count('account_restrictions', `lifted_at=is.null&or=(ends_at.is.null,ends_at.gt.${new Date().toISOString()})`),
    d.count('safety_events', `created_at=gt.${since}`),
    d.select<{ started_at: string; ended_at: string | null }>('random_chat_sessions', `select=started_at,ended_at&started_at=gt.${since}&ended_at=not.is.null&limit=1000`),
  ]);
  const durations = recentSessions.map((s) => (Date.parse(s.ended_at!) - Date.parse(s.started_at)) / 1000);
  const out: AdminMetrics = {
    online: stats.online,
    waiting: stats.waiting,
    inChat: stats.inChat,
    reportsOpen,
    reports24h,
    sessions24h,
    avgSessionSec24h: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    activeRestrictions,
    safetyEvents24h: safety24h,
    matchStats: stats.metrics,
  };
  return json(out);
}
