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
import { cn } from '@/lib/utils';

export interface Shift {
  id: string;
  branch_id: string | null;
  name: string;
  start_time: string;   // HH:MM
  end_time: string;     // HH:MM
  break_minutes: number;
  work_days: number[];  // 0=الأحد .. 6=السبت
  net_minutes: number;
  is_active: boolean;
}
interface Branch { id: string; name: string }

/** صافي الدقائق (معاينة) — نظير Shift::netMinutes، مع الوردية العابرة لمنتصف الليل. */
function netMinutes(start: string, end: string, breakMin: number): number {
  const toMin = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  let span = toMin(end) - toMin(start);
  if (span <= 0) span += 24 * 60;
  return Math.max(0, span - (breakMin || 0));
}

export function ShiftDialog({
  open,
  onClose,
  onSaved,
  shift,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  shift?: Shift | null;
}) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success } = useToast();
  const weekdays = t.raw('weekdays') as string[]; // [الأحد..السبت]

  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [workDays, setWorkDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [isActive, setIsActive] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // إعادة تعبئة الحالة من الوردية عند الفتح (تعديل) أو التصفير (إنشاء).
  useEffect(() => {
    if (!open) return;
    api<{ data: Branch[] }>('/branches').then((r) => setBranches(r.data)).catch(() => {});
    setError(null);
    setName(shift?.name ?? '');
    setBranchId(shift?.branch_id ?? '');
    setStartTime(shift?.start_time ?? '08:00');
    setEndTime(shift?.end_time ?? '16:00');
    setBreakMinutes(String(shift?.break_minutes ?? 30));
    setWorkDays(shift?.work_days ?? [0, 1, 2, 3, 4]);
    setIsActive(shift?.is_active ?? true);
  }, [open, shift]);

  const toggleDay = (d: number) =>
    setWorkDays((days) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b)));

  const net = netMinutes(startTime, endTime, Number(breakMinutes) || 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (workDays.length === 0) { setError(t('work_days_required')); return; }
    setSaving(true);
    setError(null);
    const body = {
      name,
      branch_id: branchId || null,
      start_time: startTime,
      end_time: endTime,
      break_minutes: Number(breakMinutes) || 0,
      work_days: workDays,
      is_active: isActive,
    };
    try {
      if (shift?.id) {
        await api(`/shifts/${shift.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/shifts', { method: 'POST', body });
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
    <Dialog open={open} onClose={onClose} title={shift?.id ? t('edit_shift') : t('add_shift')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="shift_name">{t('shift_name')}</Label>
            <Input id="shift_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift_branch">{t('branch')}</Label>
            <Select id="shift_branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{t('all_branches')}</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="shift_start">{t('start_time')}</Label>
            <Input id="shift_start" type="time" dir="ltr" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift_end">{t('end_time')}</Label>
            <Input id="shift_end" type="time" dir="ltr" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="shift_break">{t('break_minutes')}</Label>
            <Input id="shift_break" type="number" min={0} dir="ltr" className="num" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded border border-border bg-background px-3 py-2 text-sm">
          <span className="text-muted">{t('net_hours')}</span>
          <span className="num font-semibold text-text">{Math.floor(net / 60)} {t('hours_short')} {net % 60} {t('minutes_short')}</span>
        </div>

        <div className="space-y-1.5">
          <Label>{t('work_days')}</Label>
          <div className="flex flex-wrap gap-2">
            {weekdays.map((label, d) => {
              const active = workDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    'rounded border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    active ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface text-muted hover:bg-background'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="shift_active">{t('status_label')}</Label>
          <Select id="shift_active" value={isActive ? '1' : '0'} onChange={(e) => setIsActive(e.target.value === '1')}>
            <option value="1">{t('active')}</option>
            <option value="0">{t('inactive')}</option>
          </Select>
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
