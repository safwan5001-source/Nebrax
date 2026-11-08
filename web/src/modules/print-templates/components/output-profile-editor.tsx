'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DocumentTypeId } from '@/modules/documents/types';
import { NARROW_CONTENT_WIDTH_MM } from '@/modules/documents/components/doc-page-frame-context';
import { outputProfileFit, resolveDocumentOutputSpec } from '@/modules/documents/services/output-spec';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import {
  defaultMarginFor,
  evaluateOutputProfileForm,
  formFromProfile,
  formWithPaper,
  outputProfileUnwiredTypes,
  paperChoicesForTemplate,
  type FormError,
  type FormErrorField,
  type FormPaper,
  type OutputProfileForm,
} from '../output-profile-form';
import { readOutputProfile, type MarginSide, type OutputOrientation, type OutputProfile } from '../services/output-profile';

const MARGIN_SIDES: readonly MarginSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * «إعداد الصفحة» داخل محرر القوالب الحالي (AWJ-DOC-V2-PR3B): مقاس، اتجاه، هوامش، مقاس مخصص.
 * يمنع إدخال ما لا يقبله العقد المشترك أو لا يدعمه القالب: الصالح وحده يُرفع إلى المسودة
 * (`onChange`)، وغير الصالح يظهر خطؤه عند حقله ولا يغيّر المسودة. السلطة النهائية للخادم.
 */
export function OutputProfileEditor({
  value,
  templateId,
  documentTypes,
  disabled,
  onChange,
}: {
  /** الملف الخام من تعريف المسودة (قد يكون غائباً أو وُضع عبر API). */
  value: unknown;
  templateId: string;
  documentTypes: readonly DocumentTypeId[];
  disabled: boolean;
  onChange: (profile: OutputProfile | null) => void;
}) {
  const t = useTranslations('printTemplateStudio.pageSetup');
  const stored = useMemo(() => readOutputProfile({ output_profile: value }), [value]);
  const choices = useMemo(() => paperChoicesForTemplate(templateId), [templateId]);
  const unwired = outputProfileUnwiredTypes(documentTypes);
  const locked = disabled || unwired.length > 0;

  const [form, setForm] = useState<OutputProfileForm>(() => formFromProfile(stored));
  const lastEmitted = useRef<string | null>(JSON.stringify(stored));

  // ملف تغيّر من خارج المحرر (تبديل القالب/تحميل تفاصيل) ⇒ يُعاد بناء الحقول منه.
  useEffect(() => {
    const incoming = JSON.stringify(stored);
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setForm(formFromProfile(stored));
    }
  }, [stored]);

  const evaluation = useMemo(() => evaluateOutputProfileForm(form, templateId), [form, templateId]);

  const update = (next: OutputProfileForm) => {
    setForm(next);
    const result = evaluateOutputProfileForm(next, templateId);
    if (result.errors.length === 0) {
      lastEmitted.current = JSON.stringify(result.profile);
      onChange(result.profile);
    }
  };

  const errorFor = (field: FormErrorField): FormError | undefined => evaluation.errors.find((error) => error.field === field);
  const message = (error: FormError) => {
    const key = `error_${error.code}`;
    return t.has(key) ? t(key, { min: error.params?.min ?? 0, max: error.params?.max ?? 0 }) : t('error_generic');
  };

  const orientationsHere = choices.papers.find((item) => item.id === form.paper)?.orientations ?? ['portrait'];
  const spec = useMemo(() => resolveDocumentOutputSpec(templateId, evaluation.profile ?? stored), [evaluation.profile, stored, templateId]);
  const unsupportedStored = stored !== null && !outputProfileFit(stored, templateId).supported;
  const contentWidth = spec.frame?.contentWidthMm ?? null;

  if (choices.thermal) {
    return (
      <section data-testid="page-setup" className="space-y-2 rounded border border-border bg-surface p-3">
        <Heading title={t('title')} />
        <p className="text-sm text-muted">{t('thermal_fixed', { width: PAPER_SIZES[choices.thermal].widthMm })}</p>
      </section>
    );
  }

  const paperLabel = (id: FormPaper) => t(`paper_${id}`);
  const fieldId = (name: string) => `page-setup-${name}`;
  const invalid = (field: FormErrorField) => (errorFor(field) ? true : undefined);

  return (
    <section data-testid="page-setup" className="space-y-3 rounded border border-border bg-surface p-3 sm:p-4" aria-labelledby="page-setup-title">
      <Heading title={t('title')} />
      <p className="text-sm text-muted">{t('hint')}</p>

      {unwired.length > 0 && (
        <p role="note" data-testid="page-setup-unwired" className="rounded border border-border bg-background px-3 py-2 text-sm text-muted">{t('unwired')}</p>
      )}
      {unsupportedStored && (
        <p role="alert" data-testid="page-setup-ignored" className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text">{t('ignored_warning')}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={fieldId('paper')}>{t('paper')}</Label>
          <Select
            id={fieldId('paper')}
            data-testid="page-setup-paper"
            className="h-11"
            value={form.paper}
            disabled={locked}
            aria-invalid={invalid('paper')}
            onChange={(event) => update(formWithPaper(form, event.target.value as FormPaper, templateId))}
          >
            <option value="default">{paperLabel('default')}</option>
            {choices.papers.map((item) => <option key={item.id} value={item.id}>{paperLabel(item.id)}</option>)}
            {choices.custom && <option value="custom">{paperLabel('custom')}</option>}
          </Select>
          {errorFor('paper') && <p role="alert" data-testid="page-setup-error-paper" className="text-xs text-danger">{message(errorFor('paper')!)}</p>}
        </div>

        {form.paper !== 'default' && form.paper !== 'custom' && (
          <fieldset className="space-y-1.5" disabled={locked}>
            <legend className="text-sm font-medium text-text">{t('orientation')}</legend>
            <div className="flex gap-2" role="radiogroup" aria-label={t('orientation')}>
              {(['portrait', 'landscape'] as OutputOrientation[]).map((orientation) => {
                const available = orientationsHere.includes(orientation);
                return (
                  <Button
                    key={orientation}
                    type="button"
                    role="radio"
                    aria-checked={form.orientation === orientation}
                    data-testid={`page-setup-orientation-${orientation}`}
                    variant={form.orientation === orientation ? 'primary' : 'outline'}
                    className="h-11 flex-1"
                    disabled={locked || !available}
                    onClick={() => update({ ...form, orientation })}
                  >
                    {t(`orientation_${orientation}`)}
                  </Button>
                );
              })}
            </div>
            {errorFor('orientation') && <p role="alert" className="text-xs text-danger">{message(errorFor('orientation')!)}</p>}
          </fieldset>
        )}

        {form.paper === 'custom' && (
          <>
            <NumberField id={fieldId('custom-width')} testId="page-setup-custom-width" label={t('custom_width')} unit={t('unit_mm')} value={form.customWidth} disabled={locked} error={errorFor('custom_width') && message(errorFor('custom_width')!)} onChange={(customWidth) => update({ ...form, customWidth })} />
            <NumberField id={fieldId('custom-height')} testId="page-setup-custom-height" label={t('custom_height')} unit={t('unit_mm')} value={form.customHeight} disabled={locked} error={errorFor('custom_height') && message(errorFor('custom_height')!)} onChange={(customHeight) => update({ ...form, customHeight })} />
          </>
        )}
      </div>

      {form.paper !== 'default' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>{t('margins')}</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="page-setup-margins-reset"
              disabled={locked || !form.marginsTouched}
              onClick={() => update({ ...form, margins: { top: String(defaultMarginFor(form.paper)), right: String(defaultMarginFor(form.paper)), bottom: String(defaultMarginFor(form.paper)), left: String(defaultMarginFor(form.paper)) }, marginsTouched: false })}
            >
              {t('margins_reset')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MARGIN_SIDES.map((side) => (
              <NumberField
                key={side}
                id={fieldId(`margin-${side}`)}
                testId={`page-setup-margin-${side}`}
                label={t(`margin_${side}`)}
                unit={t('unit_mm')}
                value={form.margins[side]}
                disabled={locked}
                error={errorFor(side) && message(errorFor(side)!)}
                onChange={(next) => update({ ...form, margins: { ...form.margins, [side]: next }, marginsTouched: true })}
              />
            ))}
          </div>
        </div>
      )}

      {errorFor('form') && <p role="alert" data-testid="page-setup-error-form" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-text">{message(errorFor('form')!)}</p>}

      {spec.frame && evaluation.errors.length === 0 && (
        <p data-testid="page-setup-summary" className="text-xs text-muted" dir="auto">
          {t('summary', { width: spec.frame.paperWidthMm, height: spec.frame.paperHeightMm, content: spec.frame.contentWidthMm })}
          {contentWidth !== null && contentWidth < NARROW_CONTENT_WIDTH_MM ? ` · ${t('narrow_note')}` : ''}
        </p>
      )}
    </section>
  );
}

function Heading({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
      <h3 id="page-setup-title" className="text-sm font-semibold text-text">{title}</h3>
    </div>
  );
}

function NumberField({
  id, testId, label, unit, value, disabled, error, onChange,
}: {
  id: string;
  testId: string;
  label: string;
  unit: string;
  value: string;
  disabled: boolean;
  error?: string | false;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} <span className="text-xs text-muted">({unit})</span></Label>
      <Input
        id={id}
        data-testid={testId}
        className={cn('num h-11', error && 'border-danger')}
        dir="ltr"
        inputMode="numeric"
        type="number"
        step={1}
        min={0}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
