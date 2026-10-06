'use client';

import { useEffect, useMemo, useState } from 'react';
import { FormActions, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  MAX_DAYS_AHEAD,
  MAX_LEAD_TIME_MINUTES,
  TIME_PATTERN,
  leadTimeToMinutes,
  parseDaysAhead,
  saveSettings,
  settingsEqual,
  splitLeadTime,
  type LeadUnit,
  type ScheduleDocument,
  type ScheduleSettings,
} from './delivery-schedule';
import { failureText } from './failure-text';
import { flowersAdminT } from './messages';
import { SettingRow, SettingsList } from './settings-list';
import { currentTimeIn, timezoneGroups, zoneLabel } from './timezones';
import { useUnsavedGuard } from './use-unsaved-guard';

type Draft = {
  enabled: boolean;
  required: boolean;
  timezone: string;
  leadValue: string;
  leadUnit: LeadUnit;
  cutoff: string;
  daysAhead: string;
};

const toDraft = (settings: ScheduleSettings): Draft => {
  const lead = splitLeadTime(settings.leadTimeMinutes);

  return {
    enabled: settings.enabled,
    required: settings.required,
    timezone: settings.timezone,
    leadValue: String(lead.value),
    leadUnit: lead.unit,
    cutoff: settings.cutoffTime ?? '',
    daysAhead: String(settings.maxDaysAhead),
  };
};

function useClock(timezone: string): string | null {
  const [time, setTime] = useState<string | null>(() => currentTimeIn(timezone));
  useEffect(() => {
    setTime(currentTimeIn(timezone));
    const timer = setInterval(() => setTime(currentTimeIn(timezone)), 30_000);
    return () => clearInterval(timer);
  }, [timezone]);

  return time;
}

/**
 * FLOWERS-H2-2 / ADR-19 — قواعد توفّر موعد التسليم لقناة المتجر. تُرسَل الحقول الستة كاملةً، ويُعاد عرض ما
 * أعاده الخادم. لا تُحسب هنا مواعيد ولا سعات: الخادم وحده يشتقّ الأيام والفترات المتاحة من هذه القواعد.
 */
export function ScheduleRulesPanel({
  storeId,
  locale,
  settings,
  onSaved,
}: {
  storeId: string;
  locale: string | undefined;
  settings: ScheduleSettings;
  onSaved: (document: ScheduleDocument) => void;
}) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // إعادة المزامنة حين يتغيّر المحفوظ من الخارج (مثلاً بعد حفظ تبويب آخر أعاد المستند كاملاً).
  useEffect(() => {
    setDraft(toDraft(settings));
    setTouched({});
  }, [settings]);

  const leadMinutes = leadTimeToMinutes(draft.leadValue, draft.leadUnit);
  const days = parseDaysAhead(draft.daysAhead);
  const cutoffValid = draft.cutoff === '' || TIME_PATTERN.test(draft.cutoff);
  const candidate: ScheduleSettings | null =
    leadMinutes !== null && days !== null && cutoffValid
      ? {
          enabled: draft.enabled,
          required: draft.required,
          timezone: draft.timezone,
          leadTimeMinutes: leadMinutes,
          cutoffTime: draft.cutoff === '' ? null : draft.cutoff,
          maxDaysAhead: days,
        }
      : null;
  const dirty = candidate === null || !settingsEqual(candidate, settings);
  useUnsavedGuard(dirty);

  const clock = useClock(draft.timezone);
  const groups = useMemo(() => timezoneGroups(draft.timezone), [draft.timezone]);
  const patch = (next: Partial<Draft>) => {
    setServerError(null);
    setDraft((current) => ({ ...current, ...next }));
  };
  const touch = (field: string) => setTouched((current) => ({ ...current, [field]: true }));

  const leadError = touched.lead && leadMinutes === null ? t('schedLeadInvalid') : null;
  const daysError = touched.days && days === null ? t('schedDaysInvalid', { max: MAX_DAYS_AHEAD }) : null;
  const cutoffError = touched.cutoff && !cutoffValid ? t('schedCutoffInvalid') : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    if (candidate === null) {
      setTouched({ lead: true, days: true, cutoff: true });
      return;
    }
    setSaving(true);
    setServerError(null);
    const result = await saveSettings(storeId, candidate);
    setSaving(false);
    if (!result.ok) {
      setServerError(failureText(result, t));
      return;
    }
    toastSuccess(t('schedSaved'));
    onSaved(result.data);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-4" aria-label={t('schedTabRules')} data-schedule-rules>
      <SettingsList>
        <SettingRow
          labelId="sched-enabled-label"
          label={t('schedEnabledLabel')}
          hint={t('schedEnabledHint')}
          control={
            <Switch id="sched-enabled" aria-labelledby="sched-enabled-label" checked={draft.enabled} disabled={saving} onCheckedChange={(enabled) => patch({ enabled })} />
          }
        />
        <SettingRow
          labelId="sched-required-label"
          label={t('schedRequiredLabel')}
          hint={t('schedRequiredHint')}
          control={
            <Switch id="sched-required" aria-labelledby="sched-required-label" checked={draft.required} disabled={saving} onCheckedChange={(required) => patch({ required })} />
          }
        />
        <SettingRow
          labelId="sched-tz-label"
          label={t('schedTimezoneLabel')}
          hint={
            <>
              {t('schedTimezoneHint')}
              {clock ? (
                <span className="mt-1 block text-text" data-schedule-clock>
                  {t('schedNow', { time: clock })}
                </span>
              ) : null}
            </>
          }
          hintId="sched-tz-hint"
          control={
            <Select
              id="sched-tz"
              className="w-full sm:w-64"
              aria-labelledby="sched-tz-label"
              aria-describedby="sched-tz-hint"
              value={draft.timezone}
              disabled={saving}
              onChange={(event) => patch({ timezone: event.target.value })}
            >
              <optgroup label={t('schedTimezoneCommon')}>
                {groups.common.map((zone) => (
                  <option key={zone} value={zone}>
                    {zoneLabel(zone)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('schedTimezoneOther')}>
                {groups.other.map((zone) => (
                  <option key={zone} value={zone}>
                    {zoneLabel(zone)}
                  </option>
                ))}
              </optgroup>
            </Select>
          }
        />
        <SettingRow
          labelId="sched-lead-label"
          label={t('schedLeadLabel')}
          hint={t('schedLeadHint')}
          hintId="sched-lead-hint"
          error={leadError}
          errorId="sched-lead-error"
          control={
            <div className="flex items-center gap-2">
              <Input
                id="sched-lead"
                type="text"
                inputMode="numeric"
                dir="ltr"
                className="w-20 text-center"
                aria-labelledby="sched-lead-label"
                aria-describedby={leadError ? 'sched-lead-hint sched-lead-error' : 'sched-lead-hint'}
                aria-invalid={leadError !== null}
                value={draft.leadValue}
                disabled={saving}
                onChange={(event) => patch({ leadValue: event.target.value })}
                onBlur={() => touch('lead')}
              />
              <Select
                aria-label={t('schedLeadUnit')}
                className="w-28"
                value={draft.leadUnit}
                disabled={saving}
                onChange={(event) => patch({ leadUnit: event.target.value as LeadUnit })}
              >
                <option value="minutes">{t('schedUnitMinutes')}</option>
                <option value="hours">{t('schedUnitHours')}</option>
                <option value="days">{t('schedUnitDays')}</option>
              </Select>
            </div>
          }
        />
        <SettingRow
          labelId="sched-cutoff-label"
          label={t('schedCutoffLabel')}
          hint={t('schedCutoffHint')}
          hintId="sched-cutoff-hint"
          error={cutoffError}
          errorId="sched-cutoff-error"
          control={
            <div className="flex items-center gap-2">
              <Input
                id="sched-cutoff"
                type="time"
                dir="ltr"
                className="w-32"
                aria-labelledby="sched-cutoff-label"
                aria-describedby={cutoffError ? 'sched-cutoff-hint sched-cutoff-error' : 'sched-cutoff-hint'}
                aria-invalid={cutoffError !== null}
                value={draft.cutoff}
                disabled={saving}
                onChange={(event) => patch({ cutoff: event.target.value })}
                onBlur={() => touch('cutoff')}
              />
              {draft.cutoff !== '' ? (
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => patch({ cutoff: '' })}>
                  {t('schedCutoffClear')}
                </Button>
              ) : (
                <span className="text-xs text-muted">{t('schedCutoffNone')}</span>
              )}
            </div>
          }
        />
        <SettingRow
          labelId="sched-days-label"
          label={t('schedDaysLabel')}
          hint={t('schedDaysHint', { max: MAX_DAYS_AHEAD })}
          hintId="sched-days-hint"
          error={daysError}
          errorId="sched-days-error"
          control={
            <div className="flex items-center gap-2">
              <Input
                id="sched-days"
                type="text"
                inputMode="numeric"
                dir="ltr"
                className="w-20 text-center"
                aria-labelledby="sched-days-label"
                aria-describedby={daysError ? 'sched-days-hint sched-days-error' : 'sched-days-hint'}
                aria-invalid={daysError !== null}
                value={draft.daysAhead}
                disabled={saving}
                onChange={(event) => patch({ daysAhead: event.target.value })}
                onBlur={() => touch('days')}
              />
              <span className="text-xs text-muted">{t('schedUnitDays')}</span>
            </div>
          }
        />
      </SettingsList>

      {!draft.enabled ? <FormAlert tone="info">{t('schedOffNote')}</FormAlert> : null}
      {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

      <FormActions
        sticky={false}
        note={<span role="status">{dirty ? t('unsaved') : t('allSaved')}</span>}
        secondary={
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              setDraft(toDraft(settings));
              setTouched({});
              setServerError(null);
            }}
          >
            {t('discard')}
          </Button>
        }
        primary={
          <Button type="submit" disabled={!dirty || saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        }
      />
    </form>
  );
}
