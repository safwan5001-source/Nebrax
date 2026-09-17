'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import {
  updateCommerceStorefrontIdentity,
  type CommerceStoreLocale,
  type CommerceStoreOption,
} from '@/modules/commerce-workspace/stores';

/**
 * STORE-ADMIN-ADOPT-1B-1 — حوار إعدادات متجر: اسم المتجر واللغة الافتراضية
 * فقط، لمتجرٍ قائم بالفعل. لا شاشة/مسار جديد — يُفتح من صفّ في
 * `/commerce/stores`. يعيد تحميل الكتالوج الموثوق من الخادم بعد نجاح الحفظ
 * (`refresh`) بدل التحديث المتفائل المحلي، مطابقةً لنمط
 * `provisionCommerceStorefront`.
 */
export function StoreSettingsDialog({
  open,
  onClose,
  onSaved,
  store,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (storeId: string) => void;
  store: CommerceStoreOption;
  locale: string | undefined;
}) {
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const [name, setName] = useState(store.name);
  const [defaultLocale, setDefaultLocale] = useState<CommerceStoreLocale>(
    store.defaultLocale === 'en' ? 'en' : 'ar',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return; // يمنع إرسالاً مزدوجاً عرضياً أثناء الانتظار
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError(t('storeSettingsNameRequired'));
      return;
    }

    setSaving(true);
    try {
      const result = await updateCommerceStorefrontIdentity(store.id, {
        name: trimmedName,
        default_locale: defaultLocale,
      });
      if (!result.ok) {
        setError(t('storeSettingsFailed'));
        return;
      }
      onSaved(store.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('storeSettingsTitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="store-settings-name">{t('storeSettingsNameLabel')}</Label>
          <Input
            id="store-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="store-settings-locale">{t('storeSettingsLocaleLabel')}</Label>
          <Select
            id="store-settings-locale"
            value={defaultLocale}
            onChange={(e) => setDefaultLocale(e.target.value as CommerceStoreLocale)}
          >
            <option value="ar">{t('storeSettingsLocaleAr')}</option>
            <option value="en">{t('storeSettingsLocaleEn')}</option>
          </Select>
        </div>

        {error ? <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('storeSettingsCancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('storeSettingsSaving') : t('storeSettingsSave')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
