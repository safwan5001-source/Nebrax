'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, hasApiStatus } from '@/lib/api';

type TeamUser = {
  id: string;
  name: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  batchId: string;
  expectedVersion: number;
  currentReviewer: { id: string; name: string } | null;
  canManage: boolean;
  onSuccess: () => void;
};

export function ReviewerAssignmentDialog({
  open,
  onClose,
  batchId,
  expectedVersion,
  currentReviewer,
  canManage,
  onSuccess,
}: Props) {
  const t = useTranslations('documentCenterReview');
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [reviewerId, setReviewerId] = useState(currentReviewer?.id ?? '');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const response = await api<{ data: TeamUser[] }>(`/document-batches/${batchId}/eligible-reviewers`);
      setUsers(response.data);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [batchId, canManage]);

  useEffect(() => {
    if (open) {
      setReviewerId(currentReviewer?.id ?? '');
      setReason('');
      setError(null);
      void loadUsers();
    }
  }, [open, currentReviewer?.id, loadUsers]);

  async function submit(clear = false) {
    if (!reason.trim()) {
      setError(t('reasonRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/document-batches/${batchId}/assign-reviewer`, {
        method: 'POST',
        body: {
          expected_version: expectedVersion,
          reviewer_id: clear ? null : reviewerId || null,
          reason: reason.trim(),
        },
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(hasApiStatus(err, 409) ? t('stale') : err instanceof ApiError ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return null;

  return (
    <Dialog open={open} onClose={onClose} title={t('assign')}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {t('reviewer')}: {currentReviewer?.name ?? t('notAssigned')}
        </p>
        <div className="grid gap-2">
          <Label htmlFor="reviewer-select">{t('assignReviewer')}</Label>
          <Select
            id="reviewer-select"
            value={reviewerId}
            onChange={(event) => setReviewerId(event.target.value)}
            disabled={loading}
          >
            <option value="">{t('notAssigned')}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </Select>
        </div>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label={t('reason')}
          placeholder={t('reasonPlaceholder')}
        />
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          {currentReviewer && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void submit(true)}>
              {t('clearReviewer')}
            </Button>
          )}
          <Button type="button" disabled={saving || (!reviewerId && !currentReviewer)} onClick={() => void submit(false)}>
            {t('assign')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
