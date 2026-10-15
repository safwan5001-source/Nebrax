'use client';

/**
 * AWJ-VD-H1 / VD-3 — the «Data» tab (UX requirements §3.3).
 *
 * Names (Arabic required, English optional) and the active switch, written to the existing endpoints with no change to
 * their contract. The identifier (a dimension's key, a value's slug), the core badge and a value's product count are
 * shown but not editable. Needs `products.manage`; without it everything is disabled and the existing
 * «no permission» wording is shown by the editor.
 */

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { EditorTarget } from './types';
import type { VT } from './messages';

export interface DataDraft {
  name: string;
  nameEn: string;
  isActive: boolean;
}

export function dataFromTarget(target: EditorTarget): DataDraft {
  const row = target.kind === 'facet' ? target.facet : target.value;
  return { name: row.name, nameEn: row.nameEn ?? '', isActive: row.isActive };
}

export function sameData(a: DataDraft, b: DataDraft): boolean {
  return a.name.trim() === b.name.trim() && a.nameEn.trim() === b.nameEn.trim() && a.isActive === b.isActive;
}

export function DataTab({
  target,
  data,
  onChange,
  readOnly,
  nameError,
  coreLabel,
  t,
}: {
  target: EditorTarget;
  data: DataDraft;
  onChange: (next: DataDraft) => void;
  readOnly: boolean;
  nameError: string | null;
  coreLabel: string;
  t: VT;
}) {
  const identifier = target.kind === 'facet' ? target.facet.key : target.value.slug;
  return (
    <div className="space-y-5" data-tab-panel="data">
      <div className="space-y-1.5">
        <Label htmlFor="ve-name-ar">{t('nameAr')}</Label>
        <Input
          id="ve-name-ar"
          className="h-11"
          value={data.name}
          disabled={readOnly}
          aria-required
          aria-invalid={nameError !== null || undefined}
          aria-describedby={nameError ? 've-name-ar-error' : undefined}
          onChange={(event) => onChange({ ...data, name: event.target.value })}
        />
        {nameError ? (
          <p id="ve-name-ar-error" role="alert" className="text-xs text-negative">
            {nameError}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ve-name-en">{t('nameEn')}</Label>
        <Input
          id="ve-name-en"
          className="h-11"
          dir="ltr"
          value={data.nameEn}
          disabled={readOnly}
          onChange={(event) => onChange({ ...data, nameEn: event.target.value })}
        />
      </div>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <Label htmlFor="ve-active">{t('status')}</Label>
        <span className="flex items-center gap-2">
          <span className="text-sm text-muted">{data.isActive ? t('statusActive') : t('statusInactive')}</span>
          <Switch
            id="ve-active"
            checked={data.isActive}
            disabled={readOnly}
            onCheckedChange={(isActive) => onChange({ ...data, isActive })}
            aria-label={t('status')}
          />
        </span>
      </div>

      <dl className="space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-muted">{target.kind === 'facet' ? t('keyLabel') : t('slugLabel')}</dt>
          <dd className="flex items-center gap-2">
            <code dir="ltr" className="rounded bg-primary-soft px-1.5 py-0.5 text-xs text-muted" data-identifier="">
              {identifier}
            </code>
            {target.kind === 'facet' && target.facet.systemKey ? <Badge tone="neutral">{coreLabel}</Badge> : null}
          </dd>
        </div>
        {target.kind === 'value' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted">{t('productCountLabel')}</dt>
            <dd className="tabular-nums text-text" data-product-count="">
              {target.value.productCount}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
