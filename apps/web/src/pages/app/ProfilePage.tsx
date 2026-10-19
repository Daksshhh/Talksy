import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, Download, LogOut, Pencil, Trash2, Users } from 'lucide-react';
import { GENDER_LABELS, LANGUAGES, LIMITS, validateDisplayName, type AvatarStyle } from '@orbit/shared';
import { useMe, useUpdateMe } from '@/hooks/queries';
import { signOut } from '@/stores/authStore';
import { toast } from '@/stores/uiStore';
import { api, errorMessage } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';
import { AvatarPicker } from '@/components/auth/AvatarPicker';
import { InterestsInput } from '@/components/auth/InterestsInput';
import { GuestUpgradeCard } from '@/components/auth/GuestUpgradeCard';
import { chatClient } from '@/services/chatClient';

export default function ProfilePage() {
  const me = useMe().data!;
  const update = useUpdateMe();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ displayName: me.displayName, bio: me.bio, interests: me.interests, language: me.language, avatar: { style: me.avatarStyle as AvatarStyle, seed: me.avatarSeed } });
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  useEffect(() => {
    if (params.get('linked') === '1') {
      toast({ title: 'Google linked', body: 'Your account is now recoverable on any device.', tone: 'success' });
      params.delete('linked');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const startEdit = () => {
    setForm({ displayName: me.displayName, bio: me.bio, interests: me.interests, language: me.language, avatar: { style: me.avatarStyle, seed: me.avatarSeed } });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const n = validateDisplayName(form.displayName);
    if (!n.ok) return setError(n.error);
    try {
      await update.mutateAsync({ displayName: form.displayName.trim(), bio: form.bio, interests: form.interests, language: form.language, avatarStyle: form.avatar.style, avatarSeed: form.avatar.seed });
      toast({ title: 'Profile saved', tone: 'success' });
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const data = await api<unknown>('/api/me/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'talksy-data-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: 'Export failed', body: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    setBusy('delete');
    try {
      await api('/api/me', { method: 'DELETE', body: { confirm: 'DELETE' } });
      chatClient.shutdown();
      await signOut();
      toast({ title: 'Your account was deleted', tone: 'success' });
    } catch (e) {
      toast({ title: 'Could not delete account', body: errorMessage(e), tone: 'error' });
      setBusy(null);
    }
  };

  const lang = LANGUAGES.find((l) => l.code === me.language)?.label ?? me.language;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <Card>
        <CardBody className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
          <Avatar seed={me.avatarSeed} style={me.avatarStyle} size={96} label="Your avatar" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-extrabold">{me.displayName}</h1>
            <p className="text-sm text-muted">@{me.publicId}</p>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              <Badge tone={me.isAnonymous ? 'warning' : 'success'}>{me.isAnonymous ? 'Guest' : 'Google account'}</Badge>
              <Badge>{lang}</Badge>
              {me.preferences.showGender && me.gender !== 'prefer_not_to_say' && <Badge>{GENDER_LABELS[me.gender]}</Badge>}
            </div>
            {me.bio && <p className="mt-3 whitespace-pre-wrap break-anywhere text-sm">{me.bio}</p>}
            <div className="mt-3 flex flex-wrap justify-center gap-4 text-sm text-muted sm:justify-start">
              <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" aria-hidden /> {me.friendsCount} friends</span>
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" aria-hidden /> Member since {new Date(me.createdAt).toLocaleDateString()}</span>
            </div>
            {me.interests.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                {me.interests.map((i) => <Badge key={i} tone="primary">{i}</Badge>)}
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={startEdit} leftIcon={<Pencil className="h-4 w-4" />}>Edit</Button>
        </CardBody>
      </Card>

      {me.isAnonymous && <GuestUpgradeCard />}

      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-muted">
            Linked sign-in: {me.providers.length ? me.providers.filter((p) => p !== 'anonymous').join(', ') || 'guest only' : 'guest only'}. Your email is never visible to other users.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/app/settings"><Button variant="outline">Privacy & settings</Button></Link>
            <Button variant="outline" onClick={exportData} loading={busy === 'export'} leftIcon={<Download className="h-4 w-4" />}>Export my data</Button>
            <Button variant="outline" onClick={() => { chatClient.shutdown(); void signOut(); }} leftIcon={<LogOut className="h-4 w-4" />}>Log out</Button>
            <Button variant="ghost" className="text-danger" onClick={() => setDeleteOpen(true)} leftIcon={<Trash2 className="h-4 w-4" />}>Delete account</Button>
          </div>
          {me.isAnonymous && <p className="text-xs text-warning">Logging out of a guest account that isn't linked to Google means you can't sign back into it.</p>}
          <p className="text-xs text-muted">
            <Link to="/privacy" className="underline">Privacy Policy</Link> · <Link to="/guidelines" className="underline">Community Guidelines</Link>
          </p>
        </CardBody>
      </Card>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit profile" size="lg">
        <div className="space-y-5">
          <Field label="Display name" error={error}>
            {(p) => <Input {...p} value={form.displayName} maxLength={LIMITS.DISPLAY_NAME_MAX} onChange={(e) => setForm((current) => ({ ...current, displayName: e.target.value }))} />}
          </Field>
          <AvatarPicker value={form.avatar} onChange={(avatar) => setForm((current) => ({ ...current, avatar }))} />
          <Field label="Bio" hint={`${form.bio.length}/${LIMITS.BIO_MAX}`}>
            {(p) => <Textarea {...p} value={form.bio} maxLength={LIMITS.BIO_MAX} onChange={(e) => setForm((current) => ({ ...current, bio: e.target.value }))} placeholder="A little about you (no personal contact info)" />}
          </Field>
          <Field label="Preferred language">
            {(p) => (
              <Select {...p} value={form.language} onChange={(e) => setForm((current) => ({ ...current, language: e.target.value }))}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Select>
            )}
          </Field>
          <InterestsInput value={form.interests} onChange={(interests) => setForm((current) => ({ ...current, interests }))} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={save} loading={update.isPending}>Save changes</Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete your account?" description="This permanently deletes your profile, friends, DMs you sent, history and settings. Moderation records about abuse may be retained as described in the Privacy Policy." size="sm">
        <Field label='Type "DELETE" to confirm'>
          {(p) => <Input {...p} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />}
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={confirmText !== 'DELETE'} loading={busy === 'delete'} onClick={deleteAccount}>Delete forever</Button>
        </div>
      </Dialog>
    </div>
  );
}
