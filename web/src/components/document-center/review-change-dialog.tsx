'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';

type Props = { open: boolean; onClose: () => void; batchId: string; targetKey: string; value: unknown; expectedVersion: number; onSuccess: () => void; labels: { title: string; save: string; reason: string; stale: string } };
export function ReviewChangeDialog({ open, onClose, batchId, targetKey, value, expectedVersion, onSuccess, labels }: Props) {
 const [next, setNext] = useState(String(value ?? '')); const [reason, setReason] = useState(''); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false);
 useEffect(() => { if (open) { setNext(String(value ?? '')); setReason(''); setError(null); } }, [open, value]);
 async function submit() { if (!reason.trim()) { setError(labels.reason); return; } setSaving(true); try { const numeric = targetKey.endsWith('_minor') ? Number(next) : next; await api(`/document-batches/${batchId}/review-changes`, { method: 'POST', body: { expected_version: expectedVersion, target_key: targetKey, value: numeric, reason } }); onSuccess(); onClose(); } catch (err) { setError(err instanceof ApiError && err.status === 409 ? labels.stale : err instanceof ApiError ? err.message : labels.stale); } finally { setSaving(false); } }
 return <Dialog open={open} onClose={onClose} title={labels.title}><div className="space-y-3"><Input value={next} onChange={(event) => setNext(event.target.value)} aria-label={targetKey} /><Textarea value={reason} onChange={(event) => setReason(event.target.value)} aria-label={labels.reason} placeholder={labels.reason} />{error && <p role="alert" className="text-sm text-negative">{error}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>×</Button><Button disabled={saving} onClick={submit}>{labels.save}</Button></div></div></Dialog>;
}
