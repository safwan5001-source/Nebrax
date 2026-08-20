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

export interface LeaveRequest {
  id: string;
  employee_id: string;
  employee?: { id: string; name: string } | null;
  leave_type_id: string;
  leave_type?: { id: string; name: string; is_paid: boolean } | null;
  start_date: string;
  end_date: string;
  days_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason?: string | null;
  rejection_reason?: string | null;
  approver?: { id: string; name: string } | null;
  approved_at?: string | null;
  created_at?: string | null;
}

interface LeaveTypeOption {
  id: string;
  name: string;
  is_active: boolean;
}

/** إنشاء طلب إجازةٍ لموظفٍ محدَّد — لا تعديل، طلبٌ قائم يُوافَق/يُرفَض/يُلغى فقط. */
export function LeaveRequestDialog({
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

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeOption[]>([]);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLeaveTypeId('');
    setStartDate('');
    setEndDate('');
    setReason('');
    setError(null);
    api<{ data: LeaveTypeOption[] }>('/leave-types')
      .then((r) => setLeaveTypes(r.data.filter((lt) => lt.is_active)))
      .catch(() => setLeaveTypes([]));
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/employees/${employeeId}/leave-requests`, {
        method: 'POST',
        body: { leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate, reason: reason || null },
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
    <Dialog open={open} onClose={onClose} title={t('add_leave_request')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="leave_type_id">{t('leave_type')}</Label>
          <Select id="leave_type_id" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} required>
            <option value="" disabled>{t('select_leave_type')}</option>
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>{lt.name}</option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="leave_start_date">{t('start_date')}</Label>
            <Input id="leave_start_date" type="date" dir="ltr" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leave_end_date">{t('end_date')}</Label>
            <Input id="leave_end_date" type="date" dir="ltr" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leave_reason">{t('leave_reason')}</Label>
          <textarea
            id="leave_reason"
            rows={2}
            className="min-h-16 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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
