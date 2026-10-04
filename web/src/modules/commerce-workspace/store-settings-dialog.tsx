'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { VerticalSetupPanel } from '@/modules/commerce-workspace/vertical-setup-panel';
import {
  COMMERCE_BUSINESS_VERTICALS,
  updateCommerceStorefrontIdentity,
  type CommerceBusinessVertical,
  type CommerceStoreLocale,
  type CommerceStoreOption,
} from '@/modules/commerce-workspace/stores';

type MessageKey = Parameters<typeof commerceWorkspaceMessage>[1];

const VERTICAL_COPY: Record<CommerceBusinessVertical, { label: MessageKey; description: MessageKey }> = {
  general: { label: 'storeVerticalGeneral', description: 'storeVerticalGeneralDescription' },
  flowers_gifts: { label: 'storeVerticalFlowers', description: 'storeVerticalFlowersDescription' },
};

/** مفتاح قدرة من الخادم → نص الواجهة. مفتاحٌ غير معروف يُخفى بدل عرض معرّف خام. */
const CAPABILITY_LABEL: Record<string, MessageKey> = {
  occasions: 'storeCapOccasions',
  recipients: 'storeCapRecipients',
  gift_message: 'storeCapGiftMessage',
  personalization: 'storeCapPersonalization',
  add_ons: 'storeCapAddOns',
  delivery_scheduling: 'storeCapDeliveryScheduling',
  same_day_delivery: 'storeCapSameDayDelivery',
  structured_content: 'storeCapStructuredContent',
  vertical_sections: 'storeCapVerticalSections',
};

/**
 * STORE-ADMIN-ADOPT-1B-1 — حوار إعدادات متجر: اسم المتجر واللغة الافتراضية
 * فقط، لمتجرٍ قائم بالفعل. لا شاشة/مسار جديد — يُفتح من صفّ في
 * `/commerce/stores`. يعيد تحميل الكتالوج الموثوق من الخادم بعد نجاح الحفظ
 * (`refresh`) بدل التحديث المتفائل المحلي، مطابقةً لنمط
 * `provisionCommerceStorefront`.
 *
 * FLOWERS-H1 — «نوع النشاط»: يُرسَل `business_vertical` فقط حين يتغيّر، فيبقى
 * طلب الحفظ القديم (اسم/لغة) كما هو. قائمة «الموصى به» تعرض ما يقوله الخادم
 * عن الملف **المحفوظ** وحالة بناء كل قدرة — لا ادّعاء قدرة غير مبنية.
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
  const [businessVertical, setBusinessVertical] = useState<CommerceBusinessVertical>(store.businessVertical);
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
        ...(businessVertical !== store.businessVertical ? { business_vertical: businessVertical } : {}),
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

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-text">{t('storeVerticalLabel')}</legend>
          <p className="text-xs text-muted">{t('storeVerticalHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {COMMERCE_BUSINESS_VERTICALS.map((vertical) => {
              const checked = businessVertical === vertical;
              return (
                <label
                  key={vertical}
                  className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-start focus-within:ring-2 focus-within:ring-primary/40 ${
                    checked ? 'border-primary bg-primary/5' : 'border-border bg-surface hover:border-primary/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="store-business-vertical"
                    value={vertical}
                    checked={checked}
                    onChange={() => setBusinessVertical(vertical)}
                    className="mt-1 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-text">{t(VERTICAL_COPY[vertical].label)}</span>
                    <span className="block text-xs text-muted">{t(VERTICAL_COPY[vertical].description)}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {store.businessVertical === 'flowers_gifts' ? (
          <VerticalSetupPanel storeId={store.id} locale={locale} />
        ) : store.recommendedCapabilities.length > 0 ? (
          <section aria-label={t('storeVerticalRecommendedTitle')} className="space-y-1.5">
            <h3 className="text-xs font-medium text-text">{t('storeVerticalRecommendedTitle')}</h3>
            <ul className="divide-y divide-border rounded border border-border">
              {store.recommendedCapabilities
                .filter((capability) => CAPABILITY_LABEL[capability.key])
                .map((capability) => (
                  <li key={capability.key} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                    <span className="min-w-0 text-text">{t(CAPABILITY_LABEL[capability.key])}</span>
                    <span className={capability.available ? 'shrink-0 font-medium text-positive' : 'shrink-0 text-muted'}>
                      {capability.available ? t('storeVerticalReady') : t('storeVerticalSoon')}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

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
