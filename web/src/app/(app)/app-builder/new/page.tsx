'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FilePlus, LayoutTemplate, Palette } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldGrid, FormActions, FormAlert, FormPage, FormSection } from '@/components/nebrax';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { type AppSchema, type CreationSource } from '@/lib/app-builder';
import { APP_BUILDER_TEMPLATES } from '@/modules/app-builder/templates';

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

  const [source, setSource] = useState<CreationSource | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
        body: { name: name.trim(), name_en: nameEn.trim() || undefined, creation_source: source },
      });
      const templateSchema = source === 'template' ? APP_BUILDER_TEMPLATES.find((tpl) => tpl.id === templateId)?.schema : null;
      if (templateSchema) {
        // The app is already created at this point; a failure here leaves it on the safe
        // minimal shell instead of the chosen template rather than losing the app itself —
        // navigate through regardless, matching the Builder workspace's own "Use My Store
        // Design" failure posture (fail into a safe existing state, never block navigation).
        await seedTemplate(response.data.id, templateSchema).catch(() => undefined);
      }
      router.push(`/app-builder/${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  async function seedTemplate(appId: string, schema: AppSchema) {
    await api(`/app-builder/apps/${appId}/draft`, { method: 'PUT', body: { schema } });
  }

  return (
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
            <div role="radiogroup" aria-label={t('templateSectionTitle')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {APP_BUILDER_TEMPLATES.map((template) => {
                const selected = templateId === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTemplateId(template.id)}
                    className={cn(
                      'flex flex-col items-start gap-1.5 rounded border p-4 text-start transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-background'
                    )}
                  >
                    <span className="font-medium text-text">{t(`templates.${template.nameKey}`)}</span>
                    <span className="text-xs leading-relaxed text-muted">{t(`templates.${template.descriptionKey}`)}</span>
                  </button>
                );
              })}
            </div>
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
  );
}
