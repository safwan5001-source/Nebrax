'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { PosDialog } from '@/components/pos/pos-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface ReasonCode {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  requires_note: boolean;
}

export function PosAuditReasonDialog({
  open, title, busy, onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: { code: string; note: string }) => Promise<void> | void;
}) {
  const t = useTranslations('posAudit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setCode(''); setNote(''); setLoading(true);
    void api<{ data: ReasonCode[] }>('/pos/reason-codes')
      .then((result) => setCodes(result.data))
      .catch((failure) => setError(failure instanceof ApiError ? failure.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [open, t]);

  const selected = codes.find((entry) => entry.code === code);
  const valid = code !== '' && (!selected?.requires_note || note.trim() !== '');

  return (
    <PosDialog open={open} onClose={() => (!busy ? onClose() : null)} title={title}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (valid) void onConfirm({ code, note: note.trim() }); }}>
        <div className="space-y-1.5">
          <Label htmlFor="pos-audit-reason">{t('selectReason')}</Label>
          <select id="pos-audit-reason" value={code} disabled={loading || busy} onChange={(event) => setCode(event.target.value)} className="min-h-11 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <option value="">—</option>
            {codes.map((entry) => <option key={entry.id} value={entry.code}>{locale === 'ar' ? entry.name_ar : entry.name_en}</option>)}
          </select>
        </div>
        {selected?.requires_note && <div className="space-y-1.5"><Label htmlFor="pos-audit-reason-note">{t('additionalReason')}</Label><textarea id="pos-audit-reason-note" value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} rows={3} placeholder={t('additionalReasonPlaceholder')} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" /></div>}
        {error && <p role="alert" className="rounded border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-h-11" onClick={onClose} disabled={busy}>{tc('cancel')}</Button><Button type="submit" className="min-h-11" disabled={!valid || loading || busy}>{t('confirmAction')}</Button></div>
      </form>
    </PosDialog>
  );
}
