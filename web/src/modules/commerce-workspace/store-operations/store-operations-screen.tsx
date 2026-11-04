'use client';

import { useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Info, Plus, ShieldAlert, Store as StoreIcon, Trash2 } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/use-can';
import { StoreGate } from '../flowers-admin/store-gate';
import { useUnsavedGuard } from '../flowers-admin/use-unsaved-guard';
import type { CommerceStoreOption } from '../stores';
import { classifyError, errorReason, useResource } from '../wholesale/use-resource';
import { fetchOperations, saveOperations, type MinOrderScope, type OperationsView, type OutsideHoursPolicy } from './api';
import { addPeriod, draftFromView, MAX_PAUSE_MESSAGE, MAX_PERIODS_PER_DAY, rebaseDraft, removePeriodAt, updatePeriodAt, validateDraft, type Draft, type DraftErrors } from './form';
import { storeOperationsMessages, type StoreOperationsMessageKey } from './messages';

/** رفض الخادم → مفتاح رسالة (`reason` من `SalesChannelSettingsException`). */
export function saveErrorKey(error: unknown): StoreOperationsMessageKey {
  const reason = errorReason(error);
  if (reason === 'settings_version_conflict') return 'error.conflict';
  if (reason === 'intake_controls_deployment_disabled') return 'error.gate';
  const kind = classifyError(error);
  if (kind === 'forbidden') return 'error.forbidden';
  if (kind === 'validation') return 'error.validation';

  return 'error.generic';
}

export function StoreOperationsScreen() {
  const locale = useLocale();
  const { t } = storeOperationsMessages.forLocale(locale);
  const { can, hydrated } = useCan();

  let body;
  if (!hydrated) body = <LoadingState variant="cards" rows={2} label={t('loading')} />;
  else if (!can('commerce.channel_settings.manage')) body = <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')} />;
  else body = <StoreGate>{(store) => <StorePanel key={store.id} store={store} />}</StoreGate>;

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />
      {body}
    </div>
  );
}

function StorePanel({ store }: { store: CommerceStoreOption }) {
  const locale = useLocale();
  const { t } = storeOperationsMessages.forLocale(locale);
  const channelId = store.salesChannelId;
  const { state, reload } = useResource(() => fetchOperations(channelId as string), [channelId], { enabled: !!channelId });

  if (!channelId) return <EmptyState icon={StoreIcon} title={t('noChannelTitle')} description={t('noChannelBody')} />;
  if (state.status === 'loading') return <LoadingState variant="cards" rows={3} label={t('loading')} />;
  if (state.status === 'error') {
    if (state.kind === 'forbidden') return <EmptyState icon={ShieldAlert} title={t('forbiddenTitle')} description={t('forbiddenBody')} />;
    return <ErrorState message={t('loadError')} onRetry={reload} />;
  }

  return <OperationsForm key={`${channelId}:${state.data.version}`} channelId={channelId} initial={state.data} />;
}

function OperationsForm({ channelId, initial }: { channelId: string; initial: OperationsView }) {
  const locale = useLocale();
  const { t } = storeOperationsMessages.forLocale(locale);
  const { success } = useToast();
  const [view, setView] = useState<OperationsView>(initial);
  const [draft, setDraft] = useState<Draft>(() => draftFromView(initial));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<StoreOperationsMessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const baseline = draftFromView(view);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedGuard(dirty);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors({});
    setServerError(null);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const result = validateDraft(draft, view);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (Object.keys(result.changes).length === 0) return;
    submitting.current = true;
    setSaving(true);
    setServerError(null);
    try {
      const next = await saveOperations(channelId, view.version, result.changes);
      setView(next);
      setDraft(draftFromView(next));
      setErrors({});
      success(t('saveOk'));
    } catch (error) {
      const key = saveErrorKey(error);
      setServerError(key);
      if (key === 'error.conflict') {
        // نسخة قديمة: نجلب الأحدث ونُبقي ما حرّره المستخدم وحده؛ الحقول التي لم يلمسها تُحدَّث من الخادم
        // (فلا يُبطل «حفظ» لاحق تغيير مسؤول آخر).
        try {
          const fresh = await fetchOperations(channelId);
          const staleBase = draftFromView(view);
          setDraft((current) => rebaseDraft(current, staleBase, draftFromView(fresh)));
          setView(fresh);
        } catch {
          /* يبقى الخطأ ظاهراً */
        }
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const gateClosed = !view.deploymentEnabled;
  const err = (key: keyof DraftErrors) => (errors[key] ? <p role="alert" className="text-xs text-negative">{t(errors[key] as StoreOperationsMessageKey)}</p> : null);

  return (
    <form onSubmit={submit} noValidate>
      {/* أثناء الحفظ تُقفل الحقول كي لا تضيع تعديلات تُكتب والطلب معلَّق (الردّ يستبدل المسودة). */}
      <fieldset disabled={saving} className="m-0 min-w-0 space-y-4 border-0 p-0">
      {gateClosed ? (
        <div role="note" className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="font-medium text-text">{t('gateTitle')}</p>
            <p className="mt-0.5 text-muted">{t('gateBody')}</p>
          </div>
        </div>
      ) : null}
      {errors.gate ? <p role="alert" className="text-sm text-negative">{t('gateClosed')}</p> : null}

      <section className="space-y-3 rounded border border-border bg-surface p-4" aria-label={t('pauseTitle')}>
        <h2 className="text-sm font-semibold text-text">{t('pauseTitle')}</h2>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="so-pause">{t('pauseToggle')}</Label>
            <p className="text-xs text-muted">{t('pauseToggleHint')}</p>
            {gateClosed && draft.accepting ? <p className="text-xs text-warning">{t('gateBlocked')}</p> : null}
          </div>
          <Switch id="so-pause" checked={!draft.accepting} disabled={gateClosed && draft.accepting} onCheckedChange={(paused) => {
              setDraft((current) => ({ ...current, accepting: !paused, pausedUntil: paused ? current.pausedUntil : '' }));
              setErrors({});
              setServerError(null);
            }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="so-resume">{t('resumeAt')}</Label>
            <Input id="so-resume" type="datetime-local" dir="ltr" value={draft.pausedUntil} disabled={draft.accepting} onChange={(e) => set('pausedUntil', e.target.value)} aria-invalid={!!errors.pausedUntil} />
            <p className="text-xs text-muted">{t('resumeHint')}</p>
            {err('pausedUntil')}
          </div>
          <div className="space-y-1">
            <Label htmlFor="so-message">{t('pauseMessage')}</Label>
            <Textarea id="so-message" rows={2} maxLength={MAX_PAUSE_MESSAGE + 50} value={draft.pauseMessage} onChange={(e) => set('pauseMessage', e.target.value)} aria-invalid={!!errors.pauseMessage} />
            <p className="text-xs text-muted">{t('pauseMessageHint')}</p>
            {err('pauseMessage')}
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded border border-border bg-surface p-4" aria-label={t('hoursTitle')}>
        <h2 className="text-sm font-semibold text-text">{t('hoursTitle')}</h2>
        <p className="text-xs text-muted">{t('hoursHint')}</p>
        <ul className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6].map((weekday) => {
            const periods = draft.hours.map((p, index) => ({ p, index })).filter((x) => x.p.weekday === weekday);
            const restricted = draft.hours.length > 0;

            return (
              <li key={weekday} className="flex flex-wrap items-start gap-2" data-testid={`day-${weekday}`}>
                <span className="w-24 shrink-0 pt-2 text-sm font-medium text-text">{t(`weekday.${weekday}` as StoreOperationsMessageKey)}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  {periods.length === 0 ? <p className="pt-2 text-sm text-muted">{restricted ? t('closed') : '—'}</p> : null}
                  {periods.map(({ p, index }) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <Label className="sr-only" htmlFor={`so-open-${index}`}>{`${t(`weekday.${weekday}` as StoreOperationsMessageKey)} — ${t('opens')}`}</Label>
                      <Input id={`so-open-${index}`} type="time" dir="ltr" className="w-32" value={p.opens_at} onChange={(e) => set('hours', updatePeriodAt(draft.hours, index, { opens_at: e.target.value }))} />
                      <span className="text-xs text-muted">{t('closes')}</span>
                      <Label className="sr-only" htmlFor={`so-close-${index}`}>{`${t(`weekday.${weekday}` as StoreOperationsMessageKey)} — ${t('closes')}`}</Label>
                      <Input
                        id={`so-close-${index}`}
                        type="time"
                        dir="ltr"
                        className="w-32"
                        disabled={p.closes_at === '24:00'}
                        value={p.closes_at === '24:00' ? '' : p.closes_at}
                        onChange={(e) => set('hours', updatePeriodAt(draft.hours, index, { closes_at: e.target.value }))}
                      />
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={p.closes_at === '24:00'}
                          onChange={(e) => set('hours', updatePeriodAt(draft.hours, index, { closes_at: e.target.checked ? '24:00' : '23:59' }))}
                        />
                        {t('untilEndOfDay')}
                      </label>
                      <Button type="button" variant="ghost" size="icon" aria-label={t('removePeriod')} onClick={() => set('hours', removePeriodAt(draft.hours, index))}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {periods.length < MAX_PERIODS_PER_DAY ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => set('hours', addPeriod(draft.hours, weekday))}>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('addPeriod')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {err('hours')}
        <div className="max-w-sm space-y-1">
          <Label htmlFor="so-policy">{t('policyTitle')}</Label>
          <Select id="so-policy" value={draft.policy} onChange={(e) => set('policy', e.target.value === 'block' ? 'block' : ('accept' as OutsideHoursPolicy))}>
            <option value="accept">{t('policy.accept')}</option>
            <option value="block" disabled={gateClosed && view.outsideHoursPolicy !== 'block'}>{t('policy.block')}</option>
          </Select>
          <p className="text-xs text-muted">{t('policyHint')}</p>
        </div>
      </section>

      <section className="space-y-3 rounded border border-border bg-surface p-4" aria-label={t('minTitle')}>
        <h2 className="text-sm font-semibold text-text">{t('minTitle')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="so-min">{t('minLabel')}</Label>
            <Input id="so-min" dir="ltr" inputMode="decimal" value={draft.minOrder} disabled={gateClosed && view.minOrderMinor === null} onChange={(e) => set('minOrder', e.target.value)} aria-invalid={!!errors.minOrder} />
            <p className="text-xs text-muted">{t('minHint')}</p>
            {gateClosed && view.minOrderMinor === null ? <p className="text-xs text-warning">{t('gateBlocked')}</p> : null}
            {err('minOrder')}
          </div>
          <div className="space-y-1">
            <Label htmlFor="so-scope">{t('minScopeLabel')}</Label>
            <Select id="so-scope" value={draft.minScope} onChange={(e) => set('minScope', e.target.value === 'delivery_only' ? 'delivery_only' : ('all' as MinOrderScope))}>
              <option value="all">{t('minScope.all')}</option>
              <option value="delivery_only">{t('minScope.delivery_only')}</option>
            </Select>
          </div>
        </div>
      </section>

      {serverError ? <p role="alert" className="text-sm text-negative">{t(serverError)}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!dirty || saving}>{saving ? t('saving') : t('save')}</Button>
        <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(draftFromView(view)); setErrors({}); setServerError(null); }}>{t('discard')}</Button>
        {dirty ? <span className="text-xs text-warning">{t('unsaved')}</span> : null}
      </div>
      </fieldset>
    </form>
  );
}
