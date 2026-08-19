'use client';

import { useEffect, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function InvoiceNoteDialog({
  open,
  onClose,
  onSaved,
  invoiceId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  invoiceId: string;
}) {
  const t = useTranslations('invoiceDetail');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [body, setBody] = useState('');
  const [recordedAt, setRecordedAt] = useState(nowLocal());
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBody('');
    setRecordedAt(nowLocal());
    setFiles([]);
    setError(null);
  }, [open]);

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.target.files ?? []);
    setFiles((current) => [...current, ...incoming].slice(0, 10));
    event.target.value = '';
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() && files.length === 0) {
      setError(t('note_required'));
      return;
    }

    setSaving(true);
    setError(null);
    const form = new FormData();
    if (body.trim()) form.append('body', body.trim());
    form.append('recorded_at', recordedAt);
    files.forEach((file) => form.append('attachments[]', file));

    try {
      await api(`/invoices/${invoiceId}/notes`, { method: 'POST', body: form });
      success(t('note_saved'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={() => (saving ? null : onClose())} title={t('add_note_attachment')} className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invoice-note-date">{t('recorded_at')}</Label>
          <Input id="invoice-note-date" type="datetime-local" dir="ltr" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-note-body">{t('note')}</Label>
          <Textarea id="invoice-note-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('note_placeholder')} maxLength={5000} />
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><Label htmlFor="invoice-note-files">{t('attachments')}</Label><span className="text-xs text-muted">{t('attachment_limit')}</span></div>
          <Input id="invoice-note-files" type="file" className="cursor-pointer" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.zip" multiple onChange={selectFiles} />
          {files.length > 0 && <ul className="divide-y divide-border rounded border border-border">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="min-w-0 truncate text-text">{file.name}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('remove_attachment')} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4" /></Button></li>)}</ul>}
        </div>
        {error && <p className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{tc('back')}</Button>
          <Button type="submit" disabled={saving}><FilePlus2 className="h-4 w-4" strokeWidth={1.7} />{t('save_note')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
