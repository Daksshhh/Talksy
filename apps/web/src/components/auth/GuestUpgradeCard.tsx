import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { GoogleIcon } from './AuthDialog';
import { linkGoogle } from '@/stores/authStore';
import { errorMessage } from '@/lib/api';
import { toast } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

/** Guest -> Google upgrade via Supabase identity linking (same user id; nothing is lost). */
export function GuestUpgradeCard({ compact }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await linkGoogle();
    } catch (e) {
      toast({ title: 'Could not start Google linking', body: errorMessage(e), tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 sm:flex-row sm:items-center', compact && 'py-3')}>
      <ShieldAlert className="h-6 w-6 shrink-0 text-warning" aria-hidden />
      <div className="flex-1 text-sm">
        <p className="font-bold">You're using a guest account</p>
        <p className="text-muted">Clearing browser data or switching devices may make it unrecoverable. Link Google to keep your friends, DMs and history.</p>
      </div>
      <Button variant="outline" onClick={go} loading={busy} leftIcon={<GoogleIcon />}>
        Link Google
      </Button>
    </div>
  );
}
