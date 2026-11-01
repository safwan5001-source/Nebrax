'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { FilePlus, LayoutTemplate, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CardTitleLevel } from '@/components/ui/card';
import { FieldGrid, FormActions, FormAlert, FormPage, FormSection } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { type CreationSource } from '@/lib/app-builder';
import { fetchAppTemplates, localizedText, type AppTemplateMeta } from '@/modules/app-builder/template-catalog';

interface PathOption {
  source: CreationSource;
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
}

const PATH_OPTIONS: PathOption[] = [
  { source: 'store_design', icon: Palette, titleKey: 'storeDesignTitle', descriptionKey: 'storeDesignDescription' },
  { source: 'template', icon: LayoutTemplate, titleKey: 'templateTitle', descriptionKey: 'templateDescription' },
  { source: 'scratch', icon: FilePlus, titleKey: 'scratchTitle', descriptionKey: 'scratchDescription' },
];

/**
 * APP-BUILDER-4 — معالج الإنشاء: المسار أولاً ثم الاسم (انظر
 * `APP-BUILDER-4-UX-EVIDENCE-PASS.md`). المسارات الثلاثة تُنشئ التطبيق بنفس
 * الحدّ الأدنى الآمن من المخطط (`BuilderDraftExperienceService::minimalSafeSchema()`)
 * عبر `POST /app-builder/apps` — الفرق الوحيد في تلك الاستدعاء هو
 * `creation_source` المُخزَّن. مسار «قالب» (APP-BUILDER-9) يضيف خطوة اختيار
 * قالب مُنسَّق، ثم استدعاءً ثانياً فورياً لـ `PUT .../draft` (الموجود أصلاً منذ
 * APP-BUILDER-1، نفسه الذي يستعمله مسار «استخدام تصميم متجري» في مساحة عمل
 * الباني — APP-BUILDER-8) يزرع مخطط القالب الفعلي بدل الحدّ الأدنى. مسار
 * التصميم يبقى بلا محتوى مُهيَّأ عند الإنشاء — تصميمه الفعلي يُطبَّق لاحقاً من
 * داخل مساحة عمل الباني («استخدام تصميم متجري»، APP-BUILDER-8)، لا هنا.
 */
export default function NewAppBuilderPage() {
  const t = useTranslations('appBuilder.new');
  const tc = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();

  const [templates, setTemplates] = useState<AppTemplateMeta[] | null>(null);
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const [source, setSource] = useState<CreationSource | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // آلية واحدة تطلق الجلب: التأثير يعتمد على رقم المحاولة، و«إعادة المحاولة» تزيده فقط (لا طلبان متزامنان).
  // `cancelled` يمنع نتيجة طلب قديم (تغيّر المسار أثناءه) من الكتابة فوق الحالة.
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  React.useEffect(() => {
    if (source !== 'template' || templates !== null) return;
    let cancelled = false;
    setTemplatesFailed(false);
    fetchAppTemplates()
      .then((loaded) => { if (!cancelled) setTemplates(loaded); })
      .catch(() => { if (!cancelled) setTemplatesFailed(true); });
    return () => { cancelled = true; };
  }, [source, templates, templatesAttempt]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source) {
      setError(t('pathRequired'));
      return;
    }
    if (!name.trim()) {
      setError(t('nameRequired'));
      return;
    }
    if (source === 'template' && !templateId) {
      setError(t('templateRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await api<{ data: { id: string } }>('/app-builder/apps', {
        method: 'POST',
        body: {
          name: name.trim(),
          name_en: nameEn.trim() || undefined,
          creation_source: source,
          // AD-11: الخادم يزرع القالب ذرّياً مع إنشاء التطبيق؛ فشله يُعرض ولا يترك تطبيقاً بقشرة فارغة.
          ...(source === 'template' ? { template_key: templateId } : {}),
        },
      });
      router.push(`/app-builder/${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    // البطاقات تقع مباشرة تحت `h1` الصفحة (FormPage) — ERP-UX-014.
    <CardTitleLevel level="h2">
      <form onSubmit={submit}>
        <FormPage
          width="narrow"
          backHref="/app-builder"
          backLabel={t('back')}
          title={t('title')}
          description={t('subtitle')}
          actions={
            <FormActions
              secondary={
                <Button asChild type="button" variant="outline">
                  <Link href="/app-builder">{t('cancel')}</Link>
                </Button>
              }
              primary={
                <Button type="submit" disabled={saving || !source || !name.trim() || (source === 'template' && !templateId)}>
                  {saving ? t('creating') : t('create')}
                </Button>
              }
            />
          }
        >
          <FormSection title={t('pathSectionTitle')}>
            <div role="radiogroup" aria-label={t('pathSectionTitle')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PATH_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = source === option.source;
                return (
                  <button
                    key={option.source}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setSource(option.source);
                      if (option.source !== 'template') setTemplateId(null);
                    }}
                    className={cn(
                      'flex flex-col items-start gap-2 rounded border p-4 text-start transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-background'
                    )}
                  >
                    <Icon className={cn('h-5 w-5', selected ? 'text-primary' : 'text-muted')} strokeWidth={1.7} aria-hidden="true" />
                    <span className="font-medium text-text">{t(option.titleKey)}</span>
                    <span className="text-xs leading-relaxed text-muted">{t(option.descriptionKey)}</span>
                  </button>
                );
              })}
            </div>
          </FormSection>

          {source === 'template' ? (
            <FormSection title={t('templateSectionTitle')}>
              {templatesFailed ? (
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span role="alert">{t('templatesLoadFailed')}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setTemplatesAttempt((n) => n + 1)}>{t('templatesRetry')}</Button>
                </div>
              ) : templates === null ? (
                <p className="text-sm text-muted" role="status">{t('templatesLoading')}</p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted">{t('templatesEmpty')}</p>
              ) : (
                <div role="radiogroup" aria-label={t('templateSectionTitle')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {templates.map((template) => {
                    const selected = templateId === template.key;
                    return (
                      <button
                        key={template.key}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setTemplateId(template.key)}
                        className={cn(
                          'flex flex-col items-start gap-1.5 rounded border p-4 text-start transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-background'
                        )}
                      >
                        <span className="font-medium text-text">{localizedText(template.name, locale)}</span>
                        <span className="text-xs leading-relaxed text-muted">{localizedText(template.description, locale)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </FormSection>
          ) : null}

          {source ? (
            <FormSection title={t('nameSectionTitle')}>
              <FieldGrid>
                <div className="space-y-2">
                  <Label htmlFor="app-name">{t('nameLabel')}</Label>
                  <Input
                    id="app-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t('namePlaceholder')}
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="app-name-en">{t('nameEnLabel')}</Label>
                  <Input
                    id="app-name-en"
                    dir="ltr"
                    value={nameEn}
                    onChange={(event) => setNameEn(event.target.value)}
                    placeholder={t('nameEnPlaceholder')}
                  />
                </div>
              </FieldGrid>
            </FormSection>
          ) : null}

          {error ? <FormAlert>{error}</FormAlert> : null}
        </FormPage>
      </form>
    </CardTitleLevel>
  );
}
