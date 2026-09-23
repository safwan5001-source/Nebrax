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
import { type CreationSource } from '@/lib/app-builder';

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
 * `APP-BUILDER-4-UX-EVIDENCE-PASS.md`). المسارات الثلاثة تُنتج اليوم نفس
 * الحدّ الأدنى الآمن من المخطط (`BuilderDraftExperienceService::minimalSafeSchema()`)
 * — الفرق الوحيد فعلياً هو `creation_source` المُخزَّن؛ محتوى التصميم/القالب
 * الفعلي مؤجَّل صراحةً إلى APP-BUILDER-8/9 (موسوم في وصف كل مسار).
 */
export default function NewAppBuilderPage() {
  const t = useTranslations('appBuilder.new');
  const tc = useTranslations('common');
  const router = useRouter();

  const [source, setSource] = useState<CreationSource | null>(null);
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

    setSaving(true);
    setError(null);
    try {
      const response = await api<{ data: { id: string } }>('/app-builder/apps', {
        method: 'POST',
        body: { name: name.trim(), name_en: nameEn.trim() || undefined, creation_source: source },
      });
      router.push(`/app-builder/${response.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
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
              <Button type="submit" disabled={saving || !source || !name.trim()}>
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
                  onClick={() => setSource(option.source)}
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
