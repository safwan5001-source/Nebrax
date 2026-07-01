'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export function CostCenterDialog({
  open,
  onClose,
  onSaved,
  center,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  center?: CostCenter | null;
}) {
  const t = useTranslations('costCenters');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [code, setCode] = useState(center?.code ?? '');
  const [name, setName] = useState(center?.name ?? '');
  const [active, setActive] = useState(center?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = { code, name, is_active: active };
    try {
      if (center?.id) {
        await api(`/cost-centers/${center.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/cost-centers', { method: 'POST', body });
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
    <Dialog open={open} onClose={onClose} title={center?.id ? t('edit') : t('add')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="code">{t('code')}</Label>
          <Input id="code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('name')}</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <label className="flex items-center gap-2 pt-1 text-sm text-text">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t('active')}
        </label>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" disabled={saving}>{t('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
