'use client';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { commerceWorkspaceMessage } from './messages';
import { createCommerceStorefront, type CommerceStoreLocale } from './stores';

export function CreateStoreDialog({
  open,
  locale,
  onClose,
  onCreated,
}: {
  open: boolean;
  locale: string | undefined;
  onClose: () => void;
  onCreated: (storeId: string) => Promise<void>;
}) {
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const [name, setName] = useState('');
  const [defaultLocale, setDefaultLocale] = useState<CommerceStoreLocale>('ar');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('createStoreNameRequired'));
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const result = await createCommerceStorefront(trimmed, defaultLocale);
      if (!result.ok) {
        setError(t('createStoreFailed'));
        return;
      }
      await onCreated(result.store.id);
      setName('');
      onClose();
    } finally {
      setCreating(false);
    }
  }
  return (
    <Dialog open={open} onClose={() => !creating && onClose()} title={t('createStoreTitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="create-store-name">{t('createStoreNameLabel')}</Label>
          <Input id="create-store-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-store-locale">{t('createStoreLocaleLabel')}</Label>
          <Select id="create-store-locale" value={defaultLocale} onChange={(event) => setDefaultLocale(event.target.value as CommerceStoreLocale)}>
            <option value="ar">{t('createStoreLocaleAr')}</option>
            <option value="en">{t('createStoreLocaleEn')}</option>
          </Select>
        </div>
        {error ? <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={creating}>{t('storeSettingsCancel')}</Button>
          <Button type="submit" disabled={creating}>{creating ? t('createStoreCreating') : t('createStoreConfirm')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
