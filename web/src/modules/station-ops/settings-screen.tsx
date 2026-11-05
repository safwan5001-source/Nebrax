'use client';

import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { switchLocale } from '@/components/layout/lang-toggle';
import { formatDate } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { PageMasthead, ScreenBody } from './masthead';
import { StationGate } from './station-gate';
import type { Station } from './schemas';

const THEMES = ['system', 'light', 'dark'] as const;

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  const t = useTranslations('stationOps');
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-text">{value && value !== '' ? value : <span className="text-muted">{t('notSet')}</span>}</dd>
    </div>
  );
}

function PersonalPreferences() {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const activeTheme = mounted ? (theme ?? 'system') : null;

  return (
    <section aria-labelledby="fo-prefs-h" className="space-y-3">
      <div>
        <h2 id="fo-prefs-h" className="text-base font-semibold text-text">{t('settings.personal.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('settings.personal.hint')}</p>
      </div>

      <div className="space-y-4 rounded-[14px] border border-border bg-surface p-4">
        <fieldset>
          <legend className="text-sm font-medium text-text">{t('settings.language')}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['ar', 'en'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={locale === value}
                onClick={() => { if (locale !== value) switchLocale(locale, () => router.refresh()); }}
                className={cn('min-h-12 rounded-lg border text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', locale === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}
              >
                {t(`settings.lang.${value}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-text">{t('settings.theme')}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {THEMES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={activeTheme === value}
                onClick={() => setTheme(value)}
                className={cn('min-h-12 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', activeTheme === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}
              >
                {t(`settings.themeOption.${value}`)}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function StationInfo({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const place = [station.city, station.region].filter((part): part is string => !!part).join(' · ');

  return (
    <section aria-labelledby="fo-station-h" className="space-y-3">
      <div>
        <h2 id="fo-station-h" className="text-base font-semibold text-text">{t('settings.station.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('settings.station.hint')}</p>
      </div>
      <dl className="divide-y divide-border rounded-[14px] border border-border bg-surface px-4">
        <Row label={t('settings.station.name')} value={station.name} />
        <Row label={t('settings.station.code')} value={station.code} />
        <Row label={t('settings.station.status')} value={['active', 'inactive', 'maintenance'].includes(station.status) ? t(`assetStatus.${station.status}`) : station.status} />
        <Row label={t('settings.station.place')} value={place} />
        <Row label={t('settings.station.timezone')} value={station.timezone} />
        <Row label={t('settings.station.license')} value={station.license_number} />
        <Row label={t('settings.station.licenseExpiry')} value={station.license_expires_at ? formatDate(station.license_expires_at, locale) : null} />
      </dl>
      <p className="text-sm text-muted">{t('settings.station.readOnly')}</p>
    </section>
  );
}

export function SettingsScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <ScreenBody>
        <PersonalPreferences />
        <StationGate>{(station) => <StationInfo station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
