'use client';

import { useEffect, useState } from 'react';
import { Globe2, Palette } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { ApiError, api } from '@/lib/api';
import { persistUser, type AuthUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';

type Preferences = NonNullable<AuthUser['preferences']>;

export function AccountPreferencesCard({ user, onSaved }: { user: AuthUser | null; onSaved: (user: AuthUser) => void }) {
  const t = useTranslations('settings');
  const { setTheme } = useTheme();
  const { success, error } = useToast();
  const initial: Preferences = user?.preferences ?? { locale: 'ar', theme: 'system' };
  const [preferences, setPreferences] = useState<Preferences>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = user?.preferences ?? { locale: 'ar', theme: 'system' };
    setPreferences(next);
    setTheme(next.theme);
  }, [setTheme, user]);

  const changed = preferences.locale !== initial.locale || preferences.theme !== initial.theme;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const response = await api<{ user: AuthUser }>('/account/preferences', { method: 'PUT', body: preferences });
      persistUser(response.user);
      onSaved(response.user);
      setTheme(preferences.theme);
      success(t('preferences_saved'));

      if (preferences.locale !== initial.locale) {
        window.setTimeout(() => window.location.reload(), 250);
      }
    } catch (err) {
      error(t('preferences_save_failed'), err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="h-4 w-4 text-muted" strokeWidth={1.7} aria-hidden="true" />
            {t('preferences')}
          </CardTitle>
          <p className="text-sm text-muted">{t('preferences_hint')}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-text">
            <span>{t('display_language')}</span>
            <select
              value={preferences.locale}
              onChange={(event) => setPreferences((value) => ({ ...value, locale: event.target.value as Preferences['locale'] }))}
              className="h-10 w-full rounded border border-border bg-background px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-describedby="preferences-language-hint"
            >
              <option value="ar">{t('arabic')}</option>
              <option value="en">{t('english')}</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-text">
            <span className="flex items-center gap-1.5"><Palette className="h-3.5 w-3.5 text-muted" aria-hidden="true" />{t('theme')}</span>
            <select
              value={preferences.theme}
              onChange={(event) => setPreferences((value) => ({ ...value, theme: event.target.value as Preferences['theme'] }))}
              className="h-10 w-full rounded border border-border bg-background px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <option value="system">{t('theme_system')}</option>
              <option value="light">{t('theme_light')}</option>
              <option value="dark">{t('theme_dark')}</option>
            </select>
          </label>
        </div>
        <p id="preferences-language-hint" className="text-xs text-muted">{t('language_reload_hint')}</p>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!changed || saving}>{saving ? t('saving') : t('save_preferences')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
