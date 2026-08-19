'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';

export interface Attendance {
  id: string;
  employee_id: string;
  employee?: { id: string; name: string } | null;
  shift_id: string | null;
  shift?: { id: string; name: string } | null;
  attendance_date: string;      // YYYY-MM-DD
  check_in: string | null;      // HH:MM
  check_out: string | null;     // HH:MM
  status: AttendanceStatus;
  worked_minutes: number;
  notes: string | null;
}

interface EmployeeOption { id: string; name: string }
interface ShiftOption { id: string; name: string }

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'leave'];
const statusKey: Record<AttendanceStatus, string> = {
  present: 'att_present', absent: 'att_absent', late: 'att_late', leave: 'att_leave',
};

/** دقائق العمل (معاينة) — نظير Attendance::workedMinutes، مع الخروج بعد منتصف الليل. */
function workedMinutes(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const toMin = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  let span = toMin(checkOut) - toMin(checkIn);
  if (span < 0) span += 24 * 60;
  return Math.max(0, span);
}

export function AttendanceDialog({
  open,
  onClose,
  onSaved,
  attendance,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  attendance?: Attendance | null;
}) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [employeeId, setEmployeeId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [date, setDate] = useState('');
  const [checkIn, setCheckIn] = useState('08:00');
  const [checkOut, setCheckOut] = useState('16:00');
  const [status, setStatus] = useState<AttendanceStatus>('present');
  const [notes, setNotes] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // إعادة تعبئة الحالة من السجلّ عند الفتح (تعديل) أو التصفير (تسجيل جديد).
  useEffect(() => {
    if (!open) return;
    api<{ data: EmployeeOption[] }>('/employees').then((r) => setEmployees(r.data)).catch(() => {});
    api<{ data: ShiftOption[] }>('/shifts').then((r) => setShifts(r.data)).catch(() => {});
    setError(null);
    setEmployeeId(attendance?.employee_id ?? '');
    setShiftId(attendance?.shift_id ?? '');
    setDate(attendance?.attendance_date ?? new Date().toISOString().slice(0, 10));
    setCheckIn(attendance?.check_in ?? '08:00');
    setCheckOut(attendance?.check_out ?? '16:00');
    setStatus(attendance?.status ?? 'present');
    setNotes(attendance?.notes ?? '');
  }, [open, attendance]);

  // الغياب/الإجازة لا وقت لهما — نُخفي حقلي الوقت ونُصفّرهما عند الإرسال.
  const timed = status === 'present' || status === 'late';
  const worked = useMemo(() => (timed ? workedMinutes(checkIn, checkOut) : 0), [timed, checkIn, checkOut]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) { setError(t('select_employee')); return; }
    setSaving(true);
    setError(null);
    const body = {
      employee_id: employeeId,
      shift_id: shiftId || null,
      attendance_date: date,
      check_in: timed ? checkIn : null,
      check_out: timed ? checkOut : null,
      status,
      notes: notes || null,
    };
    try {
      if (attendance?.id) {
        await api(`/attendances/${attendance.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/attendances', { method: 'POST', body });
        success(tc('created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={attendance?.id ? t('edit_attendance') : t('add_attendance')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="att_employee">{t('employee')}</Label>
            <Select id="att_employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
              <option value="">{t('select_employee')}</option>
              {employees.map((emp) => (<option key={emp.id} value={emp.id}>{emp.name}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att_date">{t('attendance_date')}</Label>
            <Input id="att_date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="att_status">{t('status_label')}</Label>
            <Select id="att_status" value={status} onChange={(e) => setStatus(e.target.value as AttendanceStatus)}>
              {STATUSES.map((s) => (<option key={s} value={s}>{t(statusKey[s])}</option>))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att_shift">{t('shift_optional')}</Label>
            <Select id="att_shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">{t('no_shift')}</option>
              {shifts.map((sh) => (<option key={sh.id} value={sh.id}>{sh.name}</option>))}
            </Select>
          </div>
        </div>

        {/* الوقت للحاضر/المتأخر فقط — يُخفى عند الغياب/الإجازة (لا وقت محتسَب). */}
        {timed && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="att_in">{t('check_in')}</Label>
                <Input id="att_in" type="time" dir="ltr" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="att_out">{t('check_out')}</Label>
                <Input id="att_out" type="time" dir="ltr" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded border border-border bg-background px-3 py-2 text-sm">
              <span className="text-muted">{t('worked_hours')}</span>
              <span className="num font-semibold text-text">{Math.floor(worked / 60)} {t('hours_short')} {worked % 60} {t('minutes_short')}</span>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="att_notes">{t('notes')}</Label>
          <Input id="att_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" disabled={saving}>{t('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
