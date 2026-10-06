'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { FlowersAdminMessageKey, FlowersAdminT } from '../messages';
import { FlowersDialog } from '../flowers-dialog';
import {
  FIELD_TYPES,
  MAX_LENGTH_CEILING,
  MAX_OPTIONS,
  changeType,
  move,
  newOption,
  validateField,
  type FieldError,
  type FieldType,
  type PersonalizationField,
} from './personalization';

const TYPE_LABEL: Record<FieldType, FlowersAdminMessageKey> = { text: 'persTypeText', textarea: 'persTypeTextarea', select: 'persTypeSelect' };
const TYPE_HINT: Record<FieldType, FlowersAdminMessageKey> = { text: 'persTypeTextHint', textarea: 'persTypeTextareaHint', select: 'persTypeSelectHint' };

function errorText(error: FieldError, t: FlowersAdminT): string {
  switch (error.field) {
    case 'key': return error.code === 'format' ? t('persErrKeyFormat') : t('persErrKeyDuplicate');
    case 'label': return error.code === 'required' ? t('winErrRequired') : t('winErrTooLong');
    case 'labelEn': case 'helpText': return t('winErrTooLong');
    case 'maxLength': return t('persErrLength', { max: MAX_LENGTH_CEILING });
    case 'options': return error.code === 'none' ? t('persErrNoOptions') : error.code === 'noneActive' ? t('persErrNoActiveOption') : t('persErrTooManyOptions', { max: MAX_OPTIONS });
    case 'optionKey': return error.code === 'format' ? t('persErrKeyFormat') : t('persErrKeyDuplicate');
    case 'optionLabel': return error.code === 'required' ? t('winErrRequired') : t('winErrTooLong');
    case 'optionLabelEn': return t('winErrTooLong');
  }
}

/**
 * FLOWERS-H2-7 — محرِّر مُدخَل تخصيص واحد في حوار مركَّز. يعدّل نسخة محلية فقط؛ لا شيء يُحفظ على الخادم قبل
 * «حفظ» القسم. المفتاح الداخلي يُقفل بعد أول حفظ (تغييره يكسر سلالاً مفتوحة). المعاينة تُظهر شكل الأداة فقط
 * (غير تفاعلية) وليست عارضاً ثانياً للمتجر.
 */
export function PersonalizationFieldDialog({
  title,
  initial,
  others,
  readOnly,
  t,
  onClose,
  onApply,
}: {
  title: string;
  initial: PersonalizationField;
  others: readonly PersonalizationField[];
  readOnly: boolean;
  t: FlowersAdminT;
  onClose: () => void;
  onApply: (field: PersonalizationField) => void;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const firstField = useRef<HTMLInputElement>(null);
  useEffect(() => firstField.current?.focus({ preventScroll: true }), []);
  const [draft, setDraft] = useState<PersonalizationField>(initial);
  const [submitted, setSubmitted] = useState(false);
  const errors = useMemo(() => validateField(draft, others), [draft, others]);
  const patch = (next: Partial<PersonalizationField>) => setDraft((current) => ({ ...current, ...next }));
  const fieldError = (field: FieldError['field']) => (submitted ? errors.find((e) => e.field === field) : undefined);
  const optionError = (field: 'optionKey' | 'optionLabel' | 'optionLabelEn', index: number) =>
    submitted ? errors.find((e): e is Extract<FieldError, { index: number }> => e.field === field && 'index' in e && e.index === index) : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length > 0 || readOnly) return;
    onApply(draft);
  }

  const err = (field: FieldError['field']) => {
    const e = fieldError(field);
    return e ? errorText(e, t) : null;
  };
  const isSelect = draft.type === 'select';
  const previewLabel = draft.label.trim() || t('persPreviewLabel');

  return (
    <FlowersDialog open onClose={onClose} title={title} className="max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-4" data-personalization-form>
        <fieldset className="space-y-1.5" disabled={readOnly}>
          <legend className="text-sm font-medium text-text">{t('persType')}</legend>
          <div role="radiogroup" aria-label={t('persType')} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {FIELD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={draft.type === type}
                onClick={() => setDraft((current) => changeType(current, type))}
                className={cn(
                  'min-h-11 rounded border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60',
                  draft.type === type ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface text-text hover:bg-primary-soft',
                )}
              >
                {t(TYPE_LABEL[type])}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{t(TYPE_HINT[draft.type])}</p>
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor={id('label')}>{t('persLabel')}</Label>
          <Input
            id={id('label')}
            ref={firstField}
            value={draft.label}
            disabled={readOnly}
            aria-required
            aria-invalid={err('label') !== null}
            aria-describedby={err('label') ? id('label-error') : id('label-hint')}
            onChange={(e) => patch({ label: e.target.value })}
          />
          <p id={id('label-hint')} className="text-xs text-muted">{t('persLabelHint')}</p>
          {err('label') ? <p id={id('label-error')} role="alert" className="text-xs text-negative">{err('label')}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id('label-en')}>{t('persLabelEn')}</Label>
          <Input id={id('label-en')} dir="ltr" value={draft.labelEn} disabled={readOnly} aria-invalid={err('labelEn') !== null} onChange={(e) => patch({ labelEn: e.target.value })} />
          {err('labelEn') ? <p role="alert" className="text-xs text-negative">{err('labelEn')}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id('help')}>{t('persHelp')}</Label>
          <Textarea
            id={id('help')}
            rows={2}
            value={draft.helpText}
            disabled={readOnly}
            aria-invalid={err('helpText') !== null}
            aria-describedby={id('help-hint')}
            onChange={(e) => patch({ helpText: e.target.value })}
          />
          <p id={id('help-hint')} className="text-xs text-muted">{t('persHelpHint')}</p>
          {err('helpText') ? <p role="alert" className="text-xs text-negative">{err('helpText')}</p> : null}
        </div>

        {!isSelect ? (
          <div className="space-y-1.5">
            <Label htmlFor={id('max')}>{t('persMaxLength')}</Label>
            <Input
              id={id('max')}
              type="text"
              inputMode="numeric"
              dir="ltr"
              className="w-28"
              value={draft.maxLength === null ? '' : String(draft.maxLength)}
              disabled={readOnly}
              aria-invalid={err('maxLength') !== null}
              aria-describedby={err('maxLength') ? id('max-error') : undefined}
              onChange={(e) => patch({ maxLength: /^\d+$/.test(e.target.value.trim()) ? Number(e.target.value.trim()) : null })}
            />
            {err('maxLength') ? <p id={id('max-error')} role="alert" className="text-xs text-negative">{err('maxLength')}</p> : null}
          </div>
        ) : (
          <fieldset className="space-y-2" disabled={readOnly} aria-describedby={err('options') ? id('options-error') : undefined}>
            <legend className="text-sm font-medium text-text">{t('persOptions')}</legend>
            <ul className="space-y-2" data-personalization-options>
              {draft.options.map((option, index) => {
                const keyErr = optionError('optionKey', index);
                const labelErr = optionError('optionLabel', index);
                const labelEnErr = optionError('optionLabelEn', index);
                return (
                  <li key={index} className="space-y-2 rounded border border-border p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Input
                            aria-label={`${t('persOptionLabel')} ${index + 1}`}
                            value={option.label}
                            aria-invalid={labelErr !== undefined}
                            onChange={(e) => patch({ options: draft.options.map((o, i) => (i === index ? { ...o, label: e.target.value } : o)) })}
                          />
                          {labelErr ? <p role="alert" className="text-xs text-negative">{errorText(labelErr, t)}</p> : null}
                        </div>
                        <div className="space-y-1">
                          <Input
                            dir="ltr"
                            aria-label={`${t('persOptionLabelEn')} ${index + 1}`}
                            placeholder={t('persOptionLabelEn')}
                            value={option.labelEn}
                            aria-invalid={labelEnErr !== undefined}
                            onChange={(e) => patch({ options: draft.options.map((o, i) => (i === index ? { ...o, labelEn: e.target.value } : o)) })}
                          />
                          {labelEnErr ? <p role="alert" className="text-xs text-negative">{errorText(labelEnErr, t)}</p> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveUp')}: ${option.label || index + 1}`} disabled={index === 0} onClick={() => patch({ options: move(draft.options, index, -1) })}>
                          <ArrowUp className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveDown')}: ${option.label || index + 1}`} disabled={index === draft.options.length - 1} onClick={() => patch({ options: move(draft.options, index, 1) })}>
                          <ArrowDown className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`${t('winDelete')}: ${option.label || index + 1}`} onClick={() => patch({ options: draft.options.filter((_, i) => i !== index) })}>
                          <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">{t('persKey')}</span>
                        <Input
                          dir="ltr"
                          className="h-8 w-40 text-xs"
                          aria-label={`${t('persKey')} ${index + 1}`}
                          aria-invalid={keyErr !== undefined}
                          value={option.valueKey}
                          onChange={(e) => patch({ options: draft.options.map((o, i) => (i === index ? { ...o, valueKey: e.target.value } : o)) })}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span id={`${uid}-opt-active-${index}`} className="text-xs text-muted">{t('persOptionActive')}</span>
                        <Switch aria-labelledby={`${uid}-opt-active-${index}`} checked={option.isActive} onCheckedChange={(isActive) => patch({ options: draft.options.map((o, i) => (i === index ? { ...o, isActive } : o)) })} />
                      </div>
                    </div>
                    {keyErr ? <p role="alert" className="text-xs text-negative">{errorText(keyErr, t)}</p> : null}
                  </li>
                );
              })}
            </ul>
            {err('options') ? <p id={id('options-error')} role="alert" className="text-xs text-negative">{err('options')}</p> : null}
            <Button type="button" variant="outline" size="sm" disabled={draft.options.length >= MAX_OPTIONS} onClick={() => patch({ options: [...draft.options, newOption(draft)] })}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('persAddOption')}
            </Button>
          </fieldset>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={id('key')}>{t('persKey')}</Label>
          <Input
            id={id('key')}
            dir="ltr"
            value={draft.key}
            disabled={readOnly || draft.persisted}
            aria-invalid={err('key') !== null}
            aria-describedby={err('key') ? `${id('key-hint')} ${id('key-error')}` : id('key-hint')}
            onChange={(e) => patch({ key: e.target.value })}
          />
          <p id={id('key-hint')} className="text-xs text-muted">{draft.persisted ? t('persKeyLocked') : t('persKeyHint')}</p>
          {err('key') ? <p id={id('key-error')} role="alert" className="text-xs text-negative">{err('key')}</p> : null}
        </div>

        <div className="divide-y divide-border rounded border border-border">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span id={id('required-label')} className="text-sm font-medium text-text">{t('persRequired')}</span>
            <Switch aria-labelledby={id('required-label')} checked={draft.isRequired} disabled={readOnly} onCheckedChange={(isRequired) => patch({ isRequired })} />
          </div>
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span id={id('active-label')} className="text-sm font-medium text-text">{t('persActive')}</span>
            <Switch aria-labelledby={id('active-label')} checked={draft.isActive} disabled={readOnly} onCheckedChange={(isActive) => patch({ isActive })} />
          </div>
        </div>

        <div className="space-y-1.5" aria-hidden="true" data-personalization-preview>
          <p className="text-xs font-medium text-muted">{t('persPreview')}</p>
          <div className="space-y-1 rounded border border-dashed border-border bg-background p-3">
            <p className="text-sm text-text">
              {previewLabel}
              {draft.isRequired ? <span className="text-negative"> *</span> : null}
            </p>
            {draft.type === 'text' ? <div className="h-9 rounded border border-border bg-surface" /> : null}
            {draft.type === 'textarea' ? <div className="h-16 rounded border border-border bg-surface" /> : null}
            {draft.type === 'select' ? (
              <div className="space-y-1 rounded border border-border bg-surface p-2 text-xs text-muted">
                {draft.options.filter((o) => o.isActive).slice(0, 4).map((o, i) => (
                  <p key={i}>{o.label || '—'}</p>
                ))}
                {draft.options.filter((o) => o.isActive).length === 0 ? <p>—</p> : null}
              </div>
            ) : null}
            {draft.helpText.trim() ? <p className="text-xs text-muted">{draft.helpText.trim()}</p> : null}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? t('close') : t('cancel')}
          </Button>
          {!readOnly ? <Button type="submit">{t('persApply')}</Button> : null}
        </div>
      </form>
    </FlowersDialog>
  );
}
