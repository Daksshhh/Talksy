import { useState } from 'react';
import { LIMITS, REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from '@orbit/shared';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Checkbox, Textarea } from '@/components/ui/Field';
import { cn } from '@/lib/utils';

export interface ReportSubmit {
  reason: ReportReason;
  details: string;
  alsoBlock: boolean;
}

export function ReportDialog({
  open,
  onClose,
  onSubmit,
  subject,
  evidenceNote,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (r: ReportSubmit) => Promise<void> | void;
  subject: string;
  evidenceNote: string;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason) {
      setError('Please choose a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ reason, details: details.trim(), alsoBlock });
      setReason(null);
      setDetails('');
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Could not send the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Report ${subject}`} description={evidenceNote}>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">What happened?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
          {REPORT_REASONS.map((r) => (
            <label key={r} className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors', reason === r ? 'border-primary bg-primary/10' : 'border-border hover:bg-surface-2')}>
              <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[rgb(var(--primary))]" />
              {REPORT_REASON_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="report-details" className="mt-4 block text-sm font-semibold">
        Details <span className="font-normal text-muted">(optional)</span>
      </label>
      <Textarea id="report-details" className="mt-1.5" value={details} maxLength={LIMITS.REPORT_DETAILS_MAX} onChange={(e) => setDetails(e.target.value)} placeholder="Anything that helps our moderators understand." />
      <div className="mt-4">
        <Checkbox checked={alsoBlock} onChange={setAlsoBlock}>
          Also block this person (you won't be matched or contacted again)
        </Checkbox>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={submit} loading={busy}>
          Send report
        </Button>
      </div>
    </Dialog>
  );
}
