import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, Clock, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { REPORT_REASON_LABELS, type AdminMetrics, type AdminReport } from '@orbit/shared';
import { useMe } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/stores/uiStore';
import { Tabs } from '@/components/ui/Tabs';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Logo } from '@/components/ui/Logo';
import { timeAgo } from '@/lib/utils';

type Tab = 'reports' | 'metrics' | 'safety' | 'audit';

/** Moderation console. Access is decided server-side (admin_roles); this check is UX only. */
export default function AdminPage() {
  const me = useMe().data!;
  const [tab, setTab] = useState<Tab>('reports');
  if (!me.isAdmin)
    return (
      <div className="grid min-h-[100dvh] place-items-center p-6">
        <ErrorState title="Moderators only" message="You don't have access to this area." />
      </div>
    );
  return (
    <div className="mx-auto min-h-[100dvh] max-w-6xl px-4 pb-10 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/app" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-2" aria-label="Back to app">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Logo />
          <Badge tone="coral">Moderation</Badge>
        </div>
      </header>
      <Tabs<Tab> className="mt-6" label="Moderation sections" value={tab} onChange={setTab} tabs={[{ id: 'reports', label: 'Reports' }, { id: 'metrics', label: 'Metrics' }, { id: 'safety', label: 'Suspicious activity' }, { id: 'audit', label: 'Audit log' }]} />
      <div className="mt-5" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'reports' && <Reports />}
        {tab === 'metrics' && <Metrics />}
        {tab === 'safety' && <SafetyEvents />}
        {tab === 'audit' && <Audit />}
      </div>
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState<'open' | 'reviewing' | 'resolved' | 'dismissed' | 'all'>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'reports', status], queryFn: () => api<{ items: AdminReport[] }>(`/api/admin/reports?status=${status}`).then((r) => r.items) });
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="report-status" className="text-sm font-semibold">Status</label>
        <Select id="report-status" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {['open', 'reviewing', 'resolved', 'dismissed', 'all'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No reports here" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase text-muted">
              <tr><th className="p-3">When</th><th className="p-3">Reason</th><th className="p-3">Reported user</th><th className="p-3">Context</th><th className="p-3">Status</th><th className="p-3" /></tr>
            </thead>
            <tbody className="divide-y divide-border/60 bg-surface">
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td className="p-3 text-muted">{timeAgo(r.createdAt)}</td>
                  <td className="p-3 font-semibold">{REPORT_REASON_LABELS[r.reason]}</td>
                  <td className="p-3">{r.reported.displayName} {r.reported.openReports > 1 && <Badge tone="danger">{r.reported.openReports} open</Badge>} {r.reported.restriction && <Badge tone="warning">{r.reported.restriction}</Badge>}</td>
                  <td className="p-3">{r.context}</td>
                  <td className="p-3"><Badge tone={r.status === 'open' ? 'coral' : r.status === 'reviewing' ? 'warning' : 'default'}>{r.status}</Badge></td>
                  <td className="p-3 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(r.id)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <ReportDetail id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ReportDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'report', id], queryFn: () => api<AdminReport & { targetHistory: Array<{ action: string; reason: string; created_at: string }> }>(`/api/admin/reports/${id}`) });
  const [resolution, setResolution] = useState('');
  const [hours, setHours] = useState(24);
  const done = () => {
    qc.invalidateQueries({ queryKey: ['admin'] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast({ title: 'Action recorded', tone: 'success' });
      done();
    },
    onError: (e) => toast({ title: 'Action failed', body: errorMessage(e), tone: 'error' }),
  });
  const r = q.data;
  const evidence = (r?.evidence as { messages?: Array<{ from: string; text: string; ts: number }>; message?: { body: string; createdAt: string } } | null) ?? null;
  return (
    <Dialog open onClose={onClose} title="Report details" size="lg">
      {q.isLoading || !r ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <p><span className="text-muted">Reason:</span> <strong>{REPORT_REASON_LABELS[r.reason]}</strong></p>
            <p><span className="text-muted">Status:</span> {r.status}</p>
            <p><span className="text-muted">Reporter:</span> {r.reporter.displayName}</p>
            <p><span className="text-muted">Reported:</span> {r.reported.displayName} <code className="text-xs text-muted">{r.reported.id.slice(0, 8)}</code></p>
            <p><span className="text-muted">Context:</span> {r.context}</p>
            <p><span className="text-muted">Evidence expires:</span> {r.evidenceExpiresAt ? new Date(r.evidenceExpiresAt).toLocaleDateString() : '—'}</p>
          </div>
          {r.details && <p className="rounded-xl bg-surface-2 p-3 whitespace-pre-wrap break-anywhere">“{r.details}”</p>}
          <div>
            <h3 className="mb-1 font-bold">Permitted evidence</h3>
            {evidence?.messages?.length ? (
              <ol className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-3 scrollbar-thin">
                {evidence.messages.map((m, i) => (
                  <li key={i} className={m.from === 'reported' ? 'text-coral' : 'text-muted'}>
                    <strong>{m.from}:</strong> <span className="break-anywhere">{m.text}</span>
                  </li>
                ))}
              </ol>
            ) : evidence?.message ? (
              <p className="rounded-xl border border-border p-3 break-anywhere">{evidence.message.body}</p>
            ) : (
              <p className="text-muted">No message evidence (expired, not captured, or not applicable).</p>
            )}
          </div>
          {r.targetHistory?.length > 0 && (
            <div>
              <h3 className="mb-1 font-bold">Prior actions on this user</h3>
              <ul className="space-y-0.5 text-muted">{r.targetHistory.map((h, i) => <li key={i}>{h.action} · {timeAgo(h.created_at)} {h.reason && `— ${h.reason}`}</li>)}</ul>
            </div>
          )}
          <Field label="Resolution note">{(p) => <Textarea {...p} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={500} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leftIcon={<Clock className="h-4 w-4" />} onClick={() => act.mutate(() => api(`/api/admin/reports/${id}`, { method: 'POST', body: { status: 'reviewing', resolution } }))}>Mark reviewing</Button>
            <Button size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => act.mutate(() => api(`/api/admin/reports/${id}`, { method: 'POST', body: { status: 'resolved', resolution } }).then(onClose))}>Resolve</Button>
            <Button size="sm" variant="ghost" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => act.mutate(() => api(`/api/admin/reports/${id}`, { method: 'POST', body: { status: 'dismissed', resolution } }).then(onClose))}>Dismiss</Button>
          </div>
          {r.reported.id && (
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-danger/30 bg-danger/5 p-3">
              <Field label="Suspension (hours)">{(p) => <Input {...p} type="number" min={1} max={8760} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-9 w-28" />}</Field>
              <Button size="sm" variant="outline" leftIcon={<ShieldAlert className="h-4 w-4" />} onClick={() => act.mutate(() => api(`/api/admin/users/${r.reported.id}/restrict`, { method: 'POST', body: { kind: 'suspend', hours, reason: resolution || REPORT_REASON_LABELS[r.reason], reportId: id } }))}>Suspend</Button>
              <Button size="sm" variant="danger" leftIcon={<Ban className="h-4 w-4" />} onClick={() => act.mutate(() => api(`/api/admin/users/${r.reported.id}/restrict`, { method: 'POST', body: { kind: 'ban', reason: resolution || REPORT_REASON_LABELS[r.reason], reportId: id } }))}>Ban</Button>
              {r.reported.restriction && <Button size="sm" variant="ghost" onClick={() => act.mutate(() => api(`/api/admin/users/${r.reported.id}/lift`, { method: 'POST', body: { reason: resolution } }))}>Lift restriction</Button>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Metrics() {
  const q = useQuery({ queryKey: ['admin', 'metrics'], queryFn: () => api<AdminMetrics>('/api/admin/metrics'), refetchInterval: 30_000 });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const m = q.data;
  const cards = [
    ['Online now (approx.)', m.online],
    ['Searching', m.waiting],
    ['In chats', m.inChat],
    ['Open reports', m.reportsOpen],
    ['Reports (24h)', m.reports24h],
    ['Sessions (24h)', m.sessions24h],
    ['Avg session (24h)', m.avgSessionSec24h != null ? `${m.avgSessionSec24h}s` : '—'],
    ['Active restrictions', m.activeRestrictions],
    ['Safety events (24h)', m.safetyEvents24h],
    ['Match rate', m.matchStats.joins ? `${Math.round(((m.matchStats.matches * 2) / m.matchStats.joins) * 100)}%` : '—'],
    ['Avg wait to match', m.matchStats.avgWaitMs != null ? `${(m.matchStats.avgWaitMs / 1000).toFixed(1)}s` : '—'],
    ['WS disconnects / errors', `${m.matchStats.disconnects} / ${m.matchStats.wsErrors}`],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map(([label, value]) => (
        <Card key={label}><CardBody><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p></CardBody></Card>
      ))}
      <p className="col-span-full text-xs text-muted">Matchmaker counters reset when the coordinator is redeployed. Presence is heartbeat-based and approximate.</p>
    </div>
  );
}

function SafetyEvents() {
  const q = useQuery({ queryKey: ['admin', 'safety'], queryFn: () => api<{ items: Array<{ id: string; user_id: string | null; kind: string; detail: unknown; created_at: string }> }>('/api/admin/safety-events').then((r) => r.items) });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="No suspicious activity recorded" />;
  return (
    <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface text-sm">
      {q.data.map((e) => (
        <li key={e.id} className="p-3"><strong>{e.kind}</strong> · user {e.user_id?.slice(0, 8) ?? '—'} · {timeAgo(e.created_at)}<pre className="mt-1 overflow-x-auto text-xs text-muted">{JSON.stringify(e.detail)}</pre></li>
      ))}
    </ul>
  );
}

function Audit() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ items: Array<{ admin_id: string | null; target_user_id: string | null; action: string; reason: string; created_at: string }> }>('/api/admin/actions').then((r) => r.items) });
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="No moderation actions yet" />;
  return (
    <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface text-sm">
      {q.data.map((a, i) => (
        <li key={i} className="flex flex-wrap gap-x-3 p-3"><Badge>{a.action}</Badge><span>admin {a.admin_id?.slice(0, 8) ?? '—'} → user {a.target_user_id?.slice(0, 8) ?? '—'}</span><span className="text-muted">{timeAgo(a.created_at)}</span>{a.reason && <span className="w-full text-muted">{a.reason}</span>}</li>
      ))}
    </ul>
  );
}
