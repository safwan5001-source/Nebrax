'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  THEME_PRESETS, RADIUS_PRESETS, DENSITY_PRESETS, PRODUCT_CARD_PRESETS,
  presentationCssVars, isSafeHexColor, presetPrimary,
  type ThemePresetId, type RadiusId, type DensityId, type ProductCardStyleId,
} from '@/modules/store-experience-builder/presentation/tokens';
import { loadCommerceStoreCatalog, type CommerceStoreOption } from '@/modules/commerce-workspace/stores';
import { loadStorefrontPresentation, type StorefrontPresentationRecord } from '@/modules/commerce-workspace/presentation';

/**
 * APP-BUILDER-8 — لوحة المظهر: تحرير يدوي لـ `schema.theme.tokens` (رموز حرّة
 * غير محكومة — انظر `APP-BUILDER-8-UX-EVIDENCE-PASS.md`) زائداً «استخدام تصميم
 * متجري»: اكتشاف → مقارنة → معاينة → تطبيق، من نفس بيانات مخصِّص المتجر
 * الحقيقية (`StorefrontPresentationConfig`) عبر المسارات القائمة أصلاً
 * (`commerce.manage`). لون فقط يُعاين حيّاً في الكانفاس اليوم — الخلاصة
 * موثَّقة في وثيقة الأدلّة.
 */

const DEFAULT_PRIMARY = presetPrimary('awj-modern');

export const THEME_TOKEN_KEYS = [
  'primaryColor', 'accentColor', 'radius', 'density', 'productCardStyle', 'themePreset', 'fontPreset', 'displayName',
] as const;

function matchPreset(hex: string): ThemePresetId | null {
  const normalized = hex.trim().toLowerCase();
  return THEME_PRESETS.find((preset) => preset.primary === normalized)?.id ?? null;
}

/** يشتقّ من إعدادات مخصِّص المتجر مجموعة رموز `theme.tokens` المقترَحة — ألوان/نصف قطر/كثافة/بطاقة منتج فقط، لا شعارات (انظر وثيقة الأدلّة). */
export function tokensFromPresentation(config: StorefrontPresentationRecord['draft']): Record<string, string> {
  const tokens: Record<string, string> = {
    primaryColor: config.primaryColor,
    radius: config.radius,
    density: config.density,
    productCardStyle: config.productCard,
    themePreset: config.themePreset,
    fontPreset: config.fontPreset,
  };
  if (config.accentColor) tokens.accentColor = config.accentColor;
  if (config.branding.displayName.trim()) tokens.displayName = config.branding.displayName.trim();
  return tokens;
}

function SegmentedField<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'h-7 flex-1 rounded px-2 text-xs font-medium',
            value === option.id ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-primary-soft hover:text-primary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

type SyncState =
  | { phase: 'idle' }
  | { phase: 'choosingStore'; stores: CommerceStoreOption[] }
  | { phase: 'detecting' }
  | { phase: 'reviewing'; proposed: Record<string, string> }
  | { phase: 'applying'; proposed: Record<string, string> }
  | { phase: 'error'; message: string };

export function ThemePanel({
  tokens,
  onChange,
  onPreview,
}: {
  tokens: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
  onPreview: (proposed: Record<string, string> | null) => void;
}) {
  const t = useTranslations('appBuilder.builder.theme');
  const [sync, setSync] = React.useState<SyncState>({ phase: 'idle' });

  const primaryColor = isSafeHexColor(tokens.primaryColor) ? tokens.primaryColor : DEFAULT_PRIMARY;
  const radius = (RADIUS_PRESETS.some((p) => p.id === tokens.radius) ? tokens.radius : 'default') as RadiusId;
  const density = (DENSITY_PRESETS.includes(tokens.density as DensityId) ? tokens.density : 'comfortable') as DensityId;
  const productCardStyle = (
    PRODUCT_CARD_PRESETS.includes(tokens.productCardStyle as ProductCardStyleId) ? tokens.productCardStyle : 'standard'
  ) as ProductCardStyleId;

  async function startDetect() {
    setSync({ phase: 'detecting' });
    const catalog = await loadCommerceStoreCatalog();
    if (catalog.status !== 'ready' || catalog.stores.length === 0) {
      setSync({ phase: 'error', message: t('sync.noStoreFound') });
      return;
    }
    if (catalog.stores.length === 1) {
      await detectFromStore(catalog.stores[0].id);
      return;
    }
    setSync({ phase: 'choosingStore', stores: catalog.stores });
  }

  async function detectFromStore(storeId: string) {
    setSync({ phase: 'detecting' });
    const result = await loadStorefrontPresentation(storeId);
    if (!result.ok) {
      const message = result.reason === 'forbidden' ? t('sync.forbidden') : t('sync.detectFailed');
      setSync({ phase: 'error', message });
      return;
    }
    const source = result.data.published ?? result.data.draft;
    const proposed = tokensFromPresentation(source);
    setSync({ phase: 'reviewing', proposed });
    onPreview(proposed);
  }

  function cancelReview() {
    setSync({ phase: 'idle' });
    onPreview(null);
  }

  function applyReview() {
    if (sync.phase !== 'reviewing') return;
    onChange(sync.proposed);
    setSync({ phase: 'idle' });
    onPreview(null);
  }

  const diffRows = sync.phase === 'reviewing'
    ? Object.entries(sync.proposed).filter(([key, value]) => tokens[key] !== value)
    : [];

  return (
    <div className="space-y-5 p-3">
      <div>
        <p className="mb-2 text-xs font-medium text-muted">{t('presetTitle')}</p>
        <div className="grid grid-cols-3 gap-2">
          {THEME_PRESETS.map((preset) => {
            const selected = tokens.themePreset === preset.id || (!tokens.themePreset && matchPreset(primaryColor) === preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ ...presentationCssVars(preset.primary, radius), primaryColor: preset.primary, themePreset: preset.id })}
                className={cn(
                  'flex h-12 items-center justify-center rounded border text-xs font-medium',
                  selected ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/50'
                )}
                style={{ background: preset.primary, color: '#fff' }}
              >
                {t(`preset.${preset.id}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text">{t('primaryColor')}</label>
        <div className="flex items-center gap-2">
          <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded border border-border">
            <span className="absolute inset-0" style={{ background: primaryColor }} />
            <input
              type="color"
              value={primaryColor}
              onChange={(event) => {
                const hex = event.target.value;
                onChange({ ...presentationCssVars(hex, radius), primaryColor: hex, themePreset: matchPreset(hex) ?? '' });
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <Input
            className="h-9 font-mono text-xs uppercase"
            dir="ltr"
            value={primaryColor}
            onChange={(event) => {
              const hex = event.target.value;
              if (!isSafeHexColor(hex)) return;
              onChange({ ...presentationCssVars(hex, radius), primaryColor: hex, themePreset: matchPreset(hex) ?? '' });
            }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text">{t('radius')}</label>
        <SegmentedField
          value={radius}
          onChange={(next) => onChange({ ...presentationCssVars(primaryColor, next), radius: next })}
          options={RADIUS_PRESETS.map((preset) => ({ id: preset.id, label: t(`radiusOption.${preset.id}`) }))}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text">{t('density')}</label>
        <SegmentedField
          value={density}
          onChange={(next) => onChange({ density: next })}
          options={DENSITY_PRESETS.map((id) => ({ id, label: t(`densityOption.${id}`) }))}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-xs font-medium text-text">{t('productCardStyle')}</label>
        <SegmentedField
          value={productCardStyle}
          onChange={(next) => onChange({ productCardStyle: next })}
          options={PRODUCT_CARD_PRESETS.map((id) => ({ id, label: t(`productCardOption.${id}`) }))}
        />
      </div>

      <div className="border-t border-border pt-4">
        <p className="mb-1 text-xs font-medium text-muted">{t('sync.title')}</p>
        <p className="mb-2 text-[11px] leading-relaxed text-muted">{t('sync.description')}</p>

        {sync.phase === 'idle' || sync.phase === 'error' ? (
          <div className="space-y-1.5">
            <Button type="button" variant="outline" size="sm" className="h-8 w-full text-xs" onClick={startDetect}>
              {t('sync.action')}
            </Button>
            {sync.phase === 'error' ? <p className="text-[11px] text-negative">{sync.message}</p> : null}
          </div>
        ) : null}

        {sync.phase === 'choosingStore' ? (
          <div className="space-y-1.5">
            <Select
              className="h-8 text-xs"
              onChange={(event) => event.target.value && detectFromStore(event.target.value)}
              defaultValue=""
            >
              <option value="" disabled>{t('sync.chooseStore')}</option>
              {sync.stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </Select>
          </div>
        ) : null}

        {sync.phase === 'detecting' ? <p className="text-xs text-muted">{t('sync.detecting')}</p> : null}

        {sync.phase === 'reviewing' ? (
          <div className="space-y-2">
            {diffRows.length === 0 ? (
              <p className="text-xs text-muted">{t('sync.noChanges')}</p>
            ) : (
              <div className="space-y-1 rounded border border-border p-2">
                {diffRows.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted">{key}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted line-through">{tokens[key] ?? '—'}</span>
                      <span className="text-text">→</span>
                      <span className="font-medium text-text">{value}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <Button type="button" size="sm" className="h-8 flex-1 text-xs" disabled={diffRows.length === 0} onClick={applyReview}>
                {t('sync.apply')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 flex-1 text-xs" onClick={cancelReview}>
                {t('sync.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
