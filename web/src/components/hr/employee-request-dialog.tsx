'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export interface EmployeeRequest {
  id: string;
  employee_id: string;
  employee?: { id: string; name: string } | null;
  request_type_id: string;
  request_type?: { id: string; name: string } | null;
  title: string;
  description?: string | null;
  requested_date?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  rejection_reason?: string | null;
  approver?: { id: string; name: string } | null;
  approved_at?: string | null;
  created_at?: string | null;
}

interface RequestTypeOption {
  id: string;
  name: string;
  is_active: boolean;
}

/** إنشاء طلبٍ عامٍّ (سلفة/استئذان/شكوى...) لموظفٍ محدَّد. */
export function EmployeeRequestDialog({
  open, onClose, onSaved, employeeId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employeeId: string;
}) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [requestTypes, setRequestTypes] = useState<RequestTypeOption[]>([]);
  const [requestTypeId, setRequestTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequestTypeId('');
    setTitle('');
    setDescription('');
    setRequestedDate('');
    setError(null);
    api<{ data: RequestTypeOption[] }>('/request-types')
      .then((r) => setRequestTypes(r.data.filter((rt) => rt.is_active)))
      .catch(() => setRequestTypes([]));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/employees/${employeeId}/requests`, {
        method: 'POST',
        body: {
          request_type_id: requestTypeId, title,
          description: description || null, requested_date: requestedDate || null,
        },
      });
      success(tc('created'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('add_employee_request')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="request_type_id">{t('request_type')}</Label>
          <Select id="request_type_id" value={requestTypeId} onChange={(e) => setRequestTypeId(e.target.value)} required>
            <option value="" disabled>{t('select_request_type')}</option>
            {requestTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="request_title">{t('request_title')}</Label>
          <Input id="request_title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="requested_date">{t('requested_date')}</Label>
          <Input id="requested_date" type="date" dir="ltr" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="request_description">{t('request_description')}</Label>
          <textarea
            id="request_description"
            rows={3}
            className="min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
