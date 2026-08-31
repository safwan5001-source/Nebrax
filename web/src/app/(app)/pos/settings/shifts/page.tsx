'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Clock3, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface PosShift {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
}

export default function PosShiftsSettingsPage() {
  const locale = useLocale();
  const ar = locale === 'ar';
  const { success, error: errorToast } = useToast();
  const [data, setData] = useState<PosShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PosShift | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const labels = useMemo(() => ({
    title: ar ? 'ورديات نقاط البيع' : 'POS shifts',
    subtitle: ar ? 'عرّف الورديات التشغيلية المستخدمة عند بدء جلسة نقطة البيع. وهي مستقلة عن ورديات الموارد البشرية.' : 'Define operational shifts used when starting a POS session. They are independent from HR work shifts.',
    add: ar ? 'إضافة وردية' : 'Add shift',
    edit: ar ? 'تعديل الوردية' : 'Edit shift',
    name: ar ? 'اسم الوردية' : 'Shift name',
    code: ar ? 'الرمز' : 'Code',
    description: ar ? 'الوصف' : 'Description',
    status: ar ? 'الحالة' : 'Status',
    actions: ar ? 'الإجراءات' : 'Actions',
    active: ar ? 'نشطة' : 'Active',
    inactive: ar ? 'معطلة' : 'Inactive',
    save: ar ? 'حفظ' : 'Save',
    cancel: ar ? 'إلغاء' : 'Cancel',
    empty: ar ? 'لا توجد ورديات نقاط بيع بعد.' : 'No POS shifts yet.',
    loadFailed: ar ? 'تعذر تحميل ورديات نقاط البيع.' : 'Could not load POS shifts.',
    saved: ar ? 'تم حفظ وردية نقاط البيع.' : 'POS shift saved.',
    deleted: ar ? 'تم حذف وردية نقاط البيع.' : 'POS shift deleted.',
    activate: ar ? 'تفعيل' : 'Activate',
    deactivate: ar ? 'تعطيل' : 'Deactivate',
  }), [ar]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<{ data: PosShift[] }>('/pos-shifts');
      setData(result.data);
    } catch {
      errorToast(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [errorToast, labels.loadFailed]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setName('');
    setCode('');
    setDescription('');
    setDialogOpen(true);
  }

  function openEdit(shift: PosShift) {
    setEditing(shift);
    setName(shift.name);
    setCode(shift.code ?? '');
    setDescription(shift.description ?? '');
    setDialogOpen(true);
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api(editing ? `/pos-shifts/${editing.id}` : '/pos-shifts', {
        method: editing ? 'PUT' : 'POST',
        body: {
          name: name.trim(),
          code: code.trim() || null,
          description: description.trim() || null,
          is_active: editing?.is_active ?? true,
        },
      });
      success(labels.saved);
      setDialogOpen(false);
      await load();
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : labels.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function setActive(shift: PosShift, active: boolean) {
    setBusy(true);
    try {
      await api(`/pos-shifts/${shift.id}`, {
        method: 'PUT',
        body: {
          name: shift.name,
          code: shift.code,
          description: shift.description,
          is_active: active,
        },
      });
      await load();
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : labels.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(shift: PosShift) {
    setBusy(true);
    try {
      await api(`/pos-shifts/${shift.id}`, { method: 'DELETE' });
      success(labels.deleted);
      await load();
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : labels.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text">{labels.title}</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{labels.subtitle}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          {labels.add}
        </Button>
      </div>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(120px,.7fr)_minmax(220px,2fr)_100px_180px] gap-3 border-b border-border bg-surface-subtle px-4 py-2.5 text-xs font-medium text-muted md:grid">
          <span>{labels.name}</span>
          <span>{labels.code}</span>
          <span>{labels.description}</span>
          <span>{labels.status}</span>
          <span className="text-end">{labels.actions}</span>
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-muted">…</div>
        ) : data.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">{labels.empty}</div>
        ) : data.map((shift) => (
          <div key={shift.id} className="grid gap-3 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_minmax(120px,.7fr)_minmax(220px,2fr)_100px_180px] md:items-center">
            <div className="font-medium text-text">{shift.name}</div>
            <div className="font-mono text-sm text-muted">{shift.code || '—'}</div>
            <div className="text-sm text-muted">{shift.description || '—'}</div>
            <div><Badge tone={shift.is_active ? 'positive' : 'neutral'}>{shift.is_active ? labels.active : labels.inactive}</Badge></div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => openEdit(shift)} disabled={busy} aria-label={labels.edit}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setActive(shift, !shift.is_active)} disabled={busy} aria-label={shift.is_active ? labels.deactivate : labels.activate}>
                <Power className="h-3.5 w-3.5" strokeWidth={1.7} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(shift)} disabled={busy} aria-label={ar ? 'حذف' : 'Delete'}>
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title={editing ? labels.edit : labels.add}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pos-shift-name">{labels.name}</Label>
            <Input id="pos-shift-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-shift-code">{labels.code}</Label>
            <Input id="pos-shift-code" value={code} onChange={(event) => setCode(event.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-shift-description">{labels.description}</Label>
            <Input id="pos-shift-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>{labels.cancel}</Button>
            <Button onClick={save} disabled={busy || !name.trim()}>{labels.save}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
