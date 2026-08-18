'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check, Copy, FileOutput, FilePlus2, Printer, ReceiptText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ASSIGNMENT_DOCUMENT_TYPES, ASSIGNMENT_USAGES, type AssignmentUsage } from './print-template-assignment-contract';
import {
  canContinueTemplateCreation,
  creationStepLabel,
  initialTemplateCreationDraft,
  publishedSourcesForDocumentType,
  type TemplateCreationCandidate,
  type TemplateCreationDraft,
  type TemplateCreationSource,
} from '../template-creation-state';
import type { DocumentTypeId } from '@/modules/documents/types';

export interface TemplateCreationSubmission {
  documentType: DocumentTypeId;
  usage: AssignmentUsage;
  name: string;
  source: TemplateCreationSource;
}

interface PrintTemplateCreationWizardProps {
  templates: readonly TemplateCreationCandidate[];
  initialDocumentType: DocumentTypeId;
  canManage: boolean;
  onCancel: () => void;
  onSubmit: (submission: TemplateCreationSubmission) => Promise<void>;
}

const USAGE_ICONS = {
  print: Printer,
  pdf: FileOutput,
  thermal: ReceiptText,
} as const;

/**
 * P44: يجمع قرارات الإنشاء قبل أي كتابة. لا ينشئ المسودة إلا عند تأكيد الخطوة الثالثة.
 */
export function PrintTemplateCreationWizard({
  templates,
  initialDocumentType,
  canManage,
  onCancel,
  onSubmit,
}: PrintTemplateCreationWizardProps) {
  const locale = useLocale();
  const t = useTranslations('printTemplateStudio');
  const tTypes = useTranslations('documentTypes');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState<TemplateCreationDraft>(() => initialTemplateCreationDraft(
    initialDocumentType,
    t('creation_default_name', { type: tTypes(initialDocumentType) }),
  ));
  const [submitting, setSubmitting] = useState(false);
  const publishedSources = useMemo(
    () => publishedSourcesForDocumentType(templates, draft.documentType),
    [draft.documentType, templates],
  );
  const canContinue = canManage && canContinueTemplateCreation(step, draft, templates);

  const updateDraft = (changes: Partial<TemplateCreationDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  };

  const changeDocumentType = (documentType: DocumentTypeId) => {
    setDraft((current) => ({ ...current, documentType, source: { kind: 'base' } }));
  };

  const goNext = () => {
    if (!canContinue || step === 3) return;
    setStep((current) => (current + 1) as 1 | 2 | 3);
  };

  const submit = async () => {
    if (!canContinue || step !== 3) return;
    setSubmitting(true);
    try {
      await onSubmit({
        documentType: draft.documentType,
        usage: draft.usage,
        name: draft.name.trim(),
        source: draft.source,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const CurrentIcon = USAGE_ICONS[draft.usage];
  const selectedPublishedTemplateId = draft.source.kind === 'published' ? draft.source.templateId : null;
  const publishedSourceName = selectedPublishedTemplateId
    ? publishedSources.find((source) => source.templateId === selectedPublishedTemplateId)?.name
    : undefined;
  const sourceSummary = selectedPublishedTemplateId
    ? publishedSourceName ?? t('creation_source_published')
    : t('creation_source_base');

  return (
    <div className="mx-auto max-w-3xl space-y-5" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">{t('creation_label')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">{t('creation_title')}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('creation_subtitle')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
          <X className="h-4 w-4" aria-hidden="true" />{t('creation_cancel')}
        </Button>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3" aria-label={t('creation_progress_label')}>
        {([1, 2, 3] as const).map((item) => {
          const active = item === step;
          const complete = item < step;
          return (
            <li key={item} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${active ? 'border-primary bg-primary/5 text-primary' : complete ? 'border-positive/40 bg-positive/5 text-text' : 'border-border text-muted'}`} aria-current={active ? 'step' : undefined}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? 'bg-positive text-white' : active ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted'}`}>{complete ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : item}</span>
              {t(`creation_step_${creationStepLabel(item)}`)}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle className="text-base">{t(`creation_step_${creationStepLabel(step)}`)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="creation-document-type">{t('document_type')}</Label>
                <Select id="creation-document-type" value={draft.documentType} onChange={(event) => changeDocumentType(event.target.value as DocumentTypeId)} disabled={!canManage}>
                  {ASSIGNMENT_DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{tTypes(type)}</option>)}
                </Select>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-text">{t('creation_usage_label')}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {ASSIGNMENT_USAGES.map((usage) => {
                    const Icon = USAGE_ICONS[usage];
                    const selected = usage === draft.usage;
                    return (
                      <button key={usage} type="button" onClick={() => updateDraft({ usage })} disabled={!canManage} aria-pressed={selected} className={`rounded-lg border p-3 text-start transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-surface'}`}>
                        <Icon className="mb-2 h-5 w-5" aria-hidden="true" />
                        <span className="block text-sm font-medium">{t(`creation_usage_${usage}`)}</span>
                        <span className="mt-1 block text-xs text-muted">{t(`creation_usage_${usage}_hint`)}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <p className="rounded border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted">{t('creation_usage_notice')}</p>
            </>
          )}

          {step === 2 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-text">{t('creation_source_label')}</legend>
              <button type="button" onClick={() => updateDraft({ source: { kind: 'base' } })} disabled={!canManage} aria-pressed={draft.source.kind === 'base'} className={`w-full rounded-lg border p-4 text-start transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${draft.source.kind === 'base' ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface'}`}>
                <FilePlus2 className="mb-2 h-5 w-5 text-primary" aria-hidden="true" />
                <span className="block text-sm font-medium text-text">{t('creation_source_base')}</span>
                <span className="mt-1 block text-xs text-muted">{t('creation_source_base_hint', { type: tTypes(draft.documentType) })}</span>
              </button>
              {publishedSources.length > 0 && <div className="space-y-2"><p className="pt-1 text-xs font-medium text-muted">{t('creation_source_published')}</p>{publishedSources.map((source) => {
                const selected = draft.source.kind === 'published' && draft.source.templateId === source.templateId;
                return <button key={source.templateId} type="button" onClick={() => updateDraft({ source: { kind: 'published', templateId: source.templateId, revisionId: source.revisionId, version: source.version } })} disabled={!canManage} aria-pressed={selected} className={`flex w-full items-start justify-between gap-3 rounded-lg border p-4 text-start transition focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface'}`}><span><Copy className="mb-2 h-5 w-5 text-primary" aria-hidden="true" /><span className="block text-sm font-medium text-text">{source.name}</span><span className="mt-1 block text-xs text-muted">{t('creation_source_published_hint', { version: source.version })}</span></span>{selected && <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}</button>;
              })}</div>}
              {!publishedSources.length && <p className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">{t('creation_no_published_sources')}</p>}
            </fieldset>
          )}

          {step === 3 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="creation-template-name">{t('template_name')}</Label>
                <Input id="creation-template-name" value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} disabled={!canManage || submitting} />
              </div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="text-sm font-medium text-text">{t('creation_review_title')}</p>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <ReviewRow label={t('document_type')} value={tTypes(draft.documentType)} />
                  <ReviewRow label={t('creation_usage_label')} value={<span className="inline-flex items-center gap-1"><CurrentIcon className="h-3.5 w-3.5" aria-hidden="true" />{t(`creation_usage_${draft.usage}`)}</span>} />
                  <ReviewRow label={t('creation_source_label')} value={sourceSummary} />
                  <ReviewRow label={t('creation_result_label')} value={t('creation_result_draft')} />
                </dl>
              </div>
              <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">{t('creation_draft_notice')}</p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setStep((current) => (current - 1) as 1 | 2 | 3)} disabled={step === 1 || submitting}>
          {locale === 'ar' ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}{t('creation_back')}
        </Button>
        {step < 3 ? <Button onClick={goNext} disabled={!canContinue}>{t('creation_next')}{locale === 'ar' ? <ArrowLeft className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}</Button> : <Button onClick={() => void submit()} disabled={!canContinue || submitting}>{submitting ? t('creation_creating') : t('creation_confirm_draft')}<FilePlus2 className="h-4 w-4" aria-hidden="true" /></Button>}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5 font-medium text-text">{value}</dd></div>;
}
