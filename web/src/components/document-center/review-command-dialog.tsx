'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  confirmLabel: string;
  endpoint: string;
  expectedVersion: number;
  payload?: Record<string, unknown>;
  onSuccess: () => void;
  staleMessage: string;
};

export function ReviewCommandDialog({ open, onClose, title, confirmLabel, endpoint, expectedVersion, payload = {}, onSuccess, staleMessage }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!reason.trim()) { setError('reason_required'); return; }
    setSaving(true); setError(null);
    try {
      await api(endpoint, { method: 'POST', body: { ...payload, expected_version: expectedVersion, reason: reason.trim() } });
      setReason(''); onSuccess(); onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? staleMessage : err instanceof ApiError ? err.message : 'save_failed');
    } finally { setSaving(false); }
  }

  return <Dialog open={open} onClose={onClose} title={title}>
    <div className="space-y-4">
      <Textarea value={reason} onChange={(event) => setReason(event.target.value)} aria-label={title} placeholder="سبب القرار" />
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>إلغاء</Button><Button type="button" disabled={saving} onClick={submit}>{confirmLabel}</Button></div>
    </div>
  </Dialog>;
}
