'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

type TeamUser = { id: string; name: string };

type BatchRef = { id: string; version: number };

type Props = {
  open: boolean;
  onClose: () => void;
  batches: BatchRef[];
  reviewers: TeamUser[];
  clear?: boolean;
  onComplete: (result: { success: number; failed: number }) => void;
};

export function BulkReviewerDialog({ open, onClose, batches, reviewers, clear = false, onComplete }: Props) {
  const t = useTranslations('documentCenterReview');
  const [reviewerId, setReviewerId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!reason.trim()) {
      setError(t('reasonRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    const results = await Promise.allSettled(
      batches.map((batch) => api(`/document-batches/${batch.id}/assign-reviewer`, {
        method: 'POST',
        body: {
          expected_version: batch.version,
          reviewer_id: clear ? null : reviewerId || null,
          reason: reason.trim(),
        },
      })),
    );
    const success = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - success;
    setSaving(false);
    onComplete({ success, failed });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={clear ? t('bulkClearReviewer') : t('bulkAssign')}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{t('bulkSelected', { count: batches.length })}</p>
        {!clear && (
          <div className="grid gap-2">
            <Label htmlFor="bulk-reviewer">{t('assignReviewer')}</Label>
            <Select id="bulk-reviewer" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">{t('notAssigned')}</option>
              {reviewers.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </Select>
          </div>
        )}
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('reason')} placeholder={t('reasonPlaceholder')} />
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" disabled={saving || (!clear && !reviewerId)} onClick={() => void submit()}>
            {clear ? t('bulkClearReviewer') : t('bulkAssign')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
