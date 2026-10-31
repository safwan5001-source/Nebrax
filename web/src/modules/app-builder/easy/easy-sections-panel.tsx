'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { registryLabel, type AppBuilderRegistries, type AppSchemaComponent } from '@/lib/app-builder';
import { sectionSummary } from './easy-catalog';
import { sectionContains, selectionTargetFor } from './editor-mode';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * قائمة أقسام الصفحة المحددة — الوضع السهل V2 (مواصفة §4.2). الأقسام = أبناء جذر الصفحة المباشرون، **مستقلة عن الصفحات**.
 * كل تعديل يمرّ عبر معالجات المحرر نفسها (تراجع/إعادة/حفظ تفاؤلي/صلاحيات)؛ هذا العرض لا يحمل حالة مخطط.
 * العنوان الفرعي المشتق (نص/تسمية القسم) والترتيب `n/m` للنوع المكرّر **عرض فقط** ولا يُكتب في المخطط.
 */
export function EasySectionsPanel({
  sections, selectedId, canManage, registries, locale, t, onSelect, onMove, onDuplicate, onDelete, onAdd, onUndo, canUndo, undoBanner,
}: {
  sections: AppSchemaComponent[];
  selectedId: string | null;
  canManage: boolean;
  registries: AppBuilderRegistries | null;
  locale: string;
  t: Translate;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onAdd: () => void;
  onUndo: () => void;
  canUndo: boolean;
  /** يُعرض فقط ما دام الحذف هو آخر تعديل (الصفحة تُبطله عند أي تعديل لاحق، فلا يُعكس تعديل غير الحذف بالخطأ). */
  undoBanner: { name: string } | null;
}) {
  const typeTotals = new Map<string, number>();
  const typeSeen = new Map<string, number>();
  for (const s of sections) {
    const key = sectionSummary(s).primaryType;
    typeTotals.set(key, (typeTotals.get(key) ?? 0) + 1);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="easy-sections">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-semibold text-muted">{t('easy.sectionsTitle')}</p>
        <Badge tone="muted">{t('easy.sectionsCount', { count: sections.length })}</Badge>
      </div>

      {undoBanner ? (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-border bg-primary-soft px-3 py-1.5 text-xs text-text">
          <span className="min-w-0 flex-1 truncate">{t('easy.deleted', { name: undoBanner.name })}</span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!canUndo} onClick={onUndo}>
            <Undo2 className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
            {t('easy.undo')}
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sections.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">{t('easy.emptyPage')}</p>
        ) : (
          <ul className="space-y-1" aria-label={t('easy.sectionsTitle')}>
            {sections.map((section, index) => {
              const summary = sectionSummary(section);
              const definition = registries?.components[summary.primaryType];
              const typeName = definition ? registryLabel(definition.label, locale) : summary.primaryType;
              const seen = (typeSeen.get(summary.primaryType) ?? 0) + 1;
              typeSeen.set(summary.primaryType, seen);
              const total = typeTotals.get(summary.primaryType) ?? 1;
              const selected = sectionContains(section, selectedId);
              return (
                <li key={section.id} className={cn('group rounded-md border', selected ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-background')}>
                  <div className="flex items-center gap-1 px-1">
                    <button
                      type="button"
                      onClick={() => onSelect(selectionTargetFor(section))}
                      aria-current={selected ? 'true' : undefined}
                      className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded px-2 text-start"
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-text">{typeName}</span>
                        {total > 1 ? <span className="shrink-0 text-[11px] text-muted" dir="ltr">{seen}/{total}</span> : null}
                      </span>
                      {summary.title ? <span className="w-full truncate text-xs text-muted">{summary.title}</span> : null}
                    </button>
                    <div className="flex shrink-0 items-center">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('easy.moveUp')} disabled={!canManage || index === 0} onClick={() => onMove(section.id, 'up')}>
                        <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('easy.moveDown')} disabled={!canManage || index === sections.length - 1} onClick={() => onMove(section.id, 'down')}>
                        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('easy.duplicate')} disabled={!canManage} onClick={() => onDuplicate(section.id)}>
                        <Copy className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('easy.delete')} disabled={!canManage}
                        onClick={() => onDelete(section.id, summary.title ?? typeName)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <Button type="button" className="h-10 w-full" disabled={!canManage} onClick={onAdd}>
          <Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          {t('easy.addSection')}
        </Button>
      </div>
    </div>
  );
}
