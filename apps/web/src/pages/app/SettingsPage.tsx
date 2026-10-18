import { Ban } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useBlocks, useInvalidateSocial, useMe, useUpdateMe } from '@/hooks/queries';
import type { ProfilePatch } from '@orbit/shared';
import { useUi, toast } from '@/stores/uiStore';
import { api, errorMessage } from '@/lib/api';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { timeAgo } from '@/lib/utils';

export default function SettingsPage() {
  const me = useMe().data!;
  const update = useUpdateMe();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const holdToSkip = useUi((s) => s.holdToSkip);
  const setHoldToSkip = useUi((s) => s.setHoldToSkip);
  const blocks = useBlocks();
  const invalidate = useInvalidateSocial();
  const p = me.preferences;

  const set = (patch: ProfilePatch) =>
    update.mutate(patch, {
      onSuccess: () => toast({ title: 'Saved', tone: 'success' }),
      onError: (e) => toast({ title: 'Could not save', body: errorMessage(e), tone: 'error' }),
    });

  const unblock = useMutation({
    mutationFn: (id: string) => api(`/api/blocks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({ title: 'Unblocked', tone: 'success' });
      invalidate();
    },
    onError: (e) => toast({ title: 'Could not unblock', body: errorMessage(e), tone: 'error' }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-extrabold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Privacy</CardTitle></CardHeader>
        <CardBody className="divide-y divide-border/60 py-1">
          <Switch label="Show gender on my profile" description="Only friends can view profiles. Gender is never used for matching." checked={p.showGender} onChange={(v) => set({ showGender: v })} disabled={update.isPending} />
          <Switch label="Show my online status to friends" description="When off, friends see “Status hidden”." checked={p.showOnline} onChange={(v) => set({ showOnline: v })} disabled={update.isPending} />
          <Switch label="Allow friend requests from chat partners" description="Strangers from current or recent (7 days) chats can send you requests." checked={p.allowMatchRequests} onChange={(v) => set({ allowMatchRequests: v })} disabled={update.isPending} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
        <CardBody className="divide-y divide-border/60 py-1">
          <Switch label="Friend requests" checked={p.notifyFriendRequests} onChange={(v) => set({ notifyFriendRequests: v })} disabled={update.isPending} />
          <Switch label="New direct messages" description="Unread counts still update when this is off." checked={p.notifyDms} onChange={(v) => set({ notifyDms: v })} disabled={update.isPending} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Chat & appearance</CardTitle></CardHeader>
        <CardBody className="divide-y divide-border/60 py-1">
          <Switch label="Dark mode" checked={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
          <Switch label="Hold to skip" description="Require holding the Next button to avoid accidental skips." checked={holdToSkip} onChange={setHoldToSkip} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Blocked users</CardTitle></CardHeader>
        <CardBody>
          {blocks.isLoading ? (
            <Skeleton className="h-12" />
          ) : blocks.isError ? (
            <ErrorState message={errorMessage(blocks.error)} onRetry={() => blocks.refetch()} />
          ) : !blocks.data?.length ? (
            <EmptyState className="py-4" icon={<Ban className="h-6 w-6" />} title="No blocked users" />
          ) : (
            <ul className="space-y-2">
              {blocks.data.map((b) => (
                <li key={b.userId} className="flex items-center gap-3">
                  <Avatar seed={b.avatarSeed} style={b.avatarStyle} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{b.displayName}</p>
                    <p className="text-xs text-muted">Blocked {timeAgo(b.blockedAt)}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => unblock.mutate(b.userId)} disabled={unblock.isPending}>Unblock</Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
