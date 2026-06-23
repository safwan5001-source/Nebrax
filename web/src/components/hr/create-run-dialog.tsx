'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api';

// الفترة بصيغة YYYY-MM، افتراضياً الشهر الحالي.
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function CreateRunDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations('hr');
  const [period, setPeriod] = useState(currentPeriod());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/payroll-runs', { method: 'POST', body: { period } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر الإنشاء');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('create_run')} className="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted">{t('create_run_hint')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="period">{t('period')}</Label>
          <Input id="period" type="month" dir="ltr" value={period} onChange={(e) => setPeriod(e.target.value)} required />
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
