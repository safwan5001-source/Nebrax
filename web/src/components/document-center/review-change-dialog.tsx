'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, hasApiStatus } from '@/lib/api';

type Labels = {
  cancel: string;
  fieldValue: string;
  reason: string;
  reasonPlaceholder: string;
  reasonRequired: string;
  save: string;
  saveFailed: string;
  stale: string;
  title: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  batchId: string;
  fieldLabel: string;
  targetKey: string;
  value: unknown;
  expectedVersion: number;
  onSuccess: () => void;
  labels: Labels;
};

export function ReviewChangeDialog({
  open,
  onClose,
  batchId,
  fieldLabel,
  targetKey,
  value,
  expectedVersion,
  onSuccess,
  labels,
}: Props) {
  const [next, setNext] = useState(String(value ?? ''));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setNext(String(value ?? ''));
    setReason('');
    setError(null);
  }, [open, value]);

  async function submit() {
    if (!reason.trim()) {
      setError(labels.reasonRequired);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextValue = targetKey.endsWith('_minor') ? Number(next) : next;
      await api(`/document-batches/${batchId}/review-changes`, {
        method: 'POST',
        body: {
          expected_version: expectedVersion,
          target_key: targetKey,
          value: nextValue,
          reason: reason.trim(),
        },
      });
      onSuccess();
      onClose();
    } catch (exception) {
      setError(
        hasApiStatus(exception, 409)
          ? labels.stale
          : exception instanceof ApiError
            ? exception.message
            : labels.saveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={labels.title}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text" htmlFor="review-change-value">
            {labels.fieldValue}: {fieldLabel}
          </label>
          <Input
            id="review-change-value"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-text" htmlFor="review-change-reason">
            {labels.reason}
          </label>
          <Textarea
            id="review-change-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={labels.reasonPlaceholder}
          />
        </div>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {labels.cancel}
          </Button>
          <Button disabled={saving} onClick={submit}>
            {labels.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
