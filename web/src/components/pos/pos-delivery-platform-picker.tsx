'use client';

import { useLocale, useTranslations } from 'next-intl';
import { DeliveryPlatformMark } from '@/components/delivery/delivery-platform-mark';

export interface PosDeliveryPlatformOption {
  id: string;
  platform_key: string;
  display_name: string;
  display_name_en: string | null;
  logo_asset_key: string | null;
  collection_mode: 'platform_collected' | 'merchant_collected';
  external_reference_policy: 'required' | 'optional' | 'none';
}

/** اسم المنصة دائماً ظاهر. لا شعار بعيد ولا إيموجي — الأصول الرسمية غير متوفرة في المستودع. */
export function PosDeliveryPlatformPicker({
  platforms,
  selectedId,
  reference,
  disabled,
  onSelect,
  onReference,
}: {
  platforms: PosDeliveryPlatformOption[];
  selectedId: string | null;
  reference: string;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onReference: (value: string) => void;
}) {
  const t = useTranslations('pos');
  const locale = useLocale();
  if (platforms.length === 0) return null;

  const selected = platforms.find((platform) => platform.id === selectedId) ?? null;
  const showReference = selected !== null && selected.external_reference_policy !== 'none';

  function label(platform: PosDeliveryPlatformOption): string {
    return locale === 'en' ? platform.display_name_en || platform.display_name : platform.display_name;
  }

  return (
    <section className="rounded-md border border-border bg-surface p-3" data-testid="pos-delivery-platforms">
      <div className="mb-1 text-sm font-bold">{t('delivery_platform')}</div>
      <p className="mb-2 text-[11px] text-muted">{t('delivery_platform_hint')}</p>
      <div role="radiogroup" aria-label={t('delivery_platform')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button
          type="button"
          role="radio"
          aria-checked={selectedId === null}
          disabled={disabled}
          onClick={() => onSelect(null)}
          className={
            'flex min-h-14 touch-manipulation items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 ' +
            (selectedId === null ? 'border-primary bg-primary-soft ring-2 ring-primary/30' : 'border-border')
          }
        >
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background text-xs font-bold text-muted">—</span>
          <span className="truncate text-sm font-semibold">{t('delivery_platform_none')}</span>
        </button>
        {platforms.map((platform) => {
          const active = platform.id === selectedId;
          const name = label(platform);
          return (
            <button
              key={platform.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onSelect(platform.id)}
              className={
                'flex min-h-14 touch-manipulation items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 ' +
                (active ? 'border-primary bg-primary-soft ring-2 ring-primary/30' : 'border-border')
              }
            >
              <DeliveryPlatformMark platformKey={platform.platform_key} name={name} />
            </button>
          );
        })}
      </div>
      {selected?.collection_mode === 'platform_collected' ? (
        <p className="mt-2 text-xs font-semibold text-text" data-testid="pos-platform-collected-note">{t('delivery_platform_collected')}</p>
      ) : null}
      {showReference ? (
        <label className="mt-2 block text-xs font-semibold">
          {t('delivery_external_reference')}
          {selected?.external_reference_policy === 'required' ? <span className="text-negative"> *</span> : null}
          <input
            value={reference}
            disabled={disabled}
            onChange={(event) => onReference(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm font-medium text-text outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          />
        </label>
      ) : null}
    </section>
  );
}
