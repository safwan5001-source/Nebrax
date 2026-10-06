'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MAX_LABEL_LENGTH, MAX_SLOT_CAPACITY, type DeliveryMethod } from './delivery-schedule';
import type { FlowersAdminT } from './messages';
import { ALL_WEEKDAYS, hasErrors, validateSlotDraft, type SlotDraft, type SlotErrors } from './slot-editor';
import type { ShippingZoneOption } from './shipping-zones';
import { weekdayName, weekdayOrder } from './weekday-names';
import { cn } from '@/lib/utils';
import { useUnsavedGuard } from './use-unsaved-guard';

export type ZoneState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; zones: ShippingZoneOption[] };

const ERROR_KEY: Record<NonNullable<SlotErrors[keyof SlotErrors]>, Parameters<FlowersAdminT>[0]> = {
  required: 'winErrRequired',
  tooLong: 'winErrTooLong',
  range: 'winErrRange',
  format: 'winErrFormat',
  none: 'winErrNoDays',
  invalid: 'winErrCapacity',
};

/**
 * FLOWERS-H2-3 — إضافة/تعديل نافذة تسليم. التحقق المبكر يعكس الخادم (نهاية بعد البداية، يوم واحد على الأقل،
 * سعة 1–10000 أو فارغة=غير محدودة)؛ ورفض الخادم يُعرض داخل الحوار ولا يُغلقه. لا حساب سعة ولا مواعيد هنا.
 */
export function SlotDialog({
  title,
  initial,
  zones,
  locale,
  t,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: SlotDraft;
  zones: ZoneState;
  locale: string | undefined;
  t: FlowersAdminT;
  onClose: () => void;
  /** يعيد رسالة فشل الخادم، أو `null` عند النجاح (فيُغلق المستدعي الحوار). */
  onSubmit: (draft: SlotDraft) => Promise<string | null>;
}) {
  const uid = useId();
  const firstField = useRef<HTMLInputElement>(null);
  // أول حقل يستلم التركيز دون أن يقفز بالتمرير فيُخفي عنوان الحوار على الجوال.
  useEffect(() => firstField.current?.focus({ preventScroll: true }), []);
  const [draft, setDraft] = useState<SlotDraft>(initial);
  const [submitted, setSubmitted] = useState(false);
  // المنطقة المعيَّنة وقت الفتح: تبقى ظاهرةً ولو عُطّلت بعدها، أما المناطق المعطّلة الأخرى فلا تُعرض للاختيار (لا وجهة تتطابق معها).
  const [assignedZoneId] = useState(initial.shippingZoneId);
  const [saving, setSaving] = useState(false);
  // المسوّدة غير المحفوظة تُسجَّل (تحذير المتصفّح + سؤال التنقّل داخل التطبيق) حتى تُحفَظ أو يُغلق الحوار.
  useUnsavedGuard(JSON.stringify(draft) !== JSON.stringify(initial));
  const [serverError, setServerError] = useState<string | null>(null);
  const errors = useMemo(() => validateSlotDraft(draft), [draft]);
  const show = (field: keyof SlotErrors) => (submitted ? errors[field] : undefined);
  const patch = (next: Partial<SlotDraft>) => {
    setServerError(null);
    setDraft((current) => ({ ...current, ...next }));
  };
  const id = (name: string) => `${uid}-${name}`;
  const err = (field: keyof SlotErrors) => {
    const code = show(field);
    return code ? t(ERROR_KEY[code]) : null;
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) setServerError(failure);
  }

  const toggleDay = (day: number) =>
    patch({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day] });
  const allSelected = draft.weekdays.length === 7;

  return (
    <Dialog open onClose={saving ? () => undefined : onClose} title={title}>
      <form onSubmit={submit} noValidate className="space-y-4" data-slot-form>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium text-text">{t('winMethod')}</legend>
          <div role="radiogroup" aria-label={t('winMethod')} className="grid grid-cols-2 gap-2">
            {(['delivery', 'pickup'] as DeliveryMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={draft.method === method}
                disabled={saving}
                onClick={() => patch({ method })}
                className={cn(
                  'min-h-11 rounded border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  draft.method === method ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface text-text hover:bg-primary-soft',
                )}
              >
                {method === 'delivery' ? t('winMethodDelivery') : t('winMethodPickup')}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={id('label')}>{t('winLabel')}</Label>
          <Input
            id={id('label')}
            ref={firstField}
            value={draft.label}
            maxLength={MAX_LABEL_LENGTH + 20}
            disabled={saving}
            aria-required
            aria-invalid={err('label') !== null}
            aria-describedby={err('label') ? id('label-error') : id('label-hint')}
            onChange={(e) => patch({ label: e.target.value })}
          />
          <p id={id('label-hint')} className="text-xs text-muted">{t('winLabelHint')}</p>
          {err('label') ? <p id={id('label-error')} role="alert" className="text-xs text-negative">{err('label')}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id('label-en')}>{t('winLabelEn')}</Label>
          <Input
            id={id('label-en')}
            dir="ltr"
            value={draft.labelEn}
            disabled={saving}
            aria-invalid={err('labelEn') !== null}
            aria-describedby={err('labelEn') ? id('label-en-error') : undefined}
            onChange={(e) => patch({ labelEn: e.target.value })}
          />
          {err('labelEn') ? <p id={id('label-en-error')} role="alert" className="text-xs text-negative">{err('labelEn')}</p> : null}
        </div>

        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={id('start')}>{t('winStart')}</Label>
              <Input
                id={id('start')}
                type="time"
                dir="ltr"
                value={draft.startTime}
                disabled={saving}
                aria-invalid={err('time') !== null}
                aria-describedby={err('time') ? id('time-error') : undefined}
                onChange={(e) => patch({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id('end')}>{t('winEnd')}</Label>
              <Input
                id={id('end')}
                type="time"
                dir="ltr"
                value={draft.endTime}
                disabled={saving}
                aria-invalid={err('time') !== null}
                aria-describedby={err('time') ? id('time-error') : undefined}
                onChange={(e) => patch({ endTime: e.target.value })}
              />
            </div>
          </div>
          {err('time') ? <p id={id('time-error')} role="alert" className="text-xs text-negative">{err('time')}</p> : null}
        </div>

        <fieldset className="space-y-1.5" aria-describedby={err('weekdays') ? id('days-error') : undefined}>
          <div className="flex items-center justify-between gap-2">
            <legend className="text-sm font-medium text-text">{t('winDays')}</legend>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => patch({ weekdays: allSelected ? [] : [...ALL_WEEKDAYS] })}>
              {allSelected ? t('winDaysClear') : t('winDaysAll')}
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {weekdayOrder(locale).map((day) => {
              const on = draft.weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={weekdayName(day, locale, 'long')}
                  disabled={saving}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    'min-h-11 rounded border px-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface text-text hover:bg-primary-soft',
                  )}
                >
                  {weekdayName(day, locale, 'short')}
                </button>
              );
            })}
          </div>
          {err('weekdays') ? <p id={id('days-error')} role="alert" className="text-xs text-negative">{err('weekdays')}</p> : null}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={id('capacity')}>{t('winCapacity')}</Label>
          <Input
            id={id('capacity')}
            type="text"
            inputMode="numeric"
            dir="ltr"
            className="w-32"
            placeholder={t('winCapacityPlaceholder')}
            value={draft.capacity}
            disabled={saving}
            aria-invalid={err('capacity') !== null}
            aria-describedby={err('capacity') ? `${id('capacity-hint')} ${id('capacity-error')}` : id('capacity-hint')}
            onChange={(e) => patch({ capacity: e.target.value })}
          />
          <p id={id('capacity-hint')} className="text-xs text-muted">{t('winCapacityHint', { max: MAX_SLOT_CAPACITY })}</p>
          {err('capacity') ? <p id={id('capacity-error')} role="alert" className="text-xs text-negative">{err('capacity')}</p> : null}
        </div>

        {draft.method === 'delivery' ? (
          <div className="space-y-1.5">
            <Label htmlFor={id('zone')}>{t('winZone')}</Label>
            <Select
              id={id('zone')}
              value={draft.shippingZoneId}
              disabled={saving || zones.kind === 'loading'}
              aria-describedby={id('zone-hint')}
              onChange={(e) => patch({ shippingZoneId: e.target.value })}
            >
              <option value="">{t('winZoneAny')}</option>
              {zones.kind === 'ready'
                ? zones.zones
                    .filter((zone) => zone.isActive || zone.id === assignedZoneId)
                    .map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                        {zone.isActive ? '' : ` — ${t('winZoneInactive')}`}
                      </option>
                    ))
                : null}
              {/* منطقة محفوظة لم تُحمَّل قائمتها تبقى خياراً قائماً فلا تُمسح بصمت. */}
              {draft.shippingZoneId !== '' && !(zones.kind === 'ready' && zones.zones.some((z) => z.id === draft.shippingZoneId)) ? (
                <option value={draft.shippingZoneId}>{t('winZoneKept')}</option>
              ) : null}
            </Select>
            <p id={id('zone-hint')} className="text-xs text-muted">
              {zones.kind === 'failed' ? t('winZoneLoadFailed') : t('winZoneHint')}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
          <span id={id('active-label')} className="text-sm font-medium text-text">{t('winActive')}</span>
          <Switch aria-labelledby={id('active-label')} checked={draft.isActive} disabled={saving} onCheckedChange={(isActive) => patch({ isActive })} />
        </div>

        {serverError ? <FormAlert tone="error">{serverError}</FormAlert> : null}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
