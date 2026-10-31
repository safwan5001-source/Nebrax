'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { registryLabel, type AppBuilderRegistries, type AppSchemaComponent, type EditorMetaNode } from '@/lib/app-builder';
import { IssueDot, sectionMarker, type IssueMarkers } from '../issue-markers';
import { sectionSummary } from './easy-catalog';
import { sectionContains, selectionTargetFor } from './editor-mode';
import { InlineRename } from './inline-rename';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * قائمة أقسام الصفحة المحددة — الوضع السهل V2 (مواصفة §4.2). الأقسام = أبناء جذر الصفحة المباشرون، **مستقلة عن الصفحات**.
 * كل تعديل يمرّ عبر معالجات المحرر نفسها (تراجع/إعادة/حفظ تفاؤلي/صلاحيات)؛ هذا العرض لا يحمل حالة مخطط.
 * العنوان الفرعي المشتق (نص/تسمية القسم) والترتيب `n/m` للنوع المكرّر **عرض فقط** ولا يُكتب في المخطط.
 */
export function EasySectionsPanel({
  sections, selectedId, canManage, registries, locale, t, onSelect, onMove, onDuplicate, onDelete, onAdd, onUndo, canUndo, undoBanner, markers,
  nodeMeta, onToggleHidden, onRename, pageTitle, pageTitleCustom, onRenamePage,
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
  /** شارات مشكلات العقد للصفحة المعروضة (لكل قسم أشدّ ما فيه). */
  markers: IssueMarkers;
  /** بيانات المحرر (AD-05): أسماء الأقسام وإخفاؤها — لا تدخل المخطط المنشور. */
  /** بيانات المحرر لأقسام **هذه الصفحة** (مقيَّدة بالصفحة). */
  nodeMeta: Record<string, EditorMetaNode>;
  onToggleHidden: (id: string) => void;
  /** اسم فارغ = العودة للاسم المشتق. */
  onRename: (id: string, name: string) => void;
  /** العنوان المعروض (المخصّص أو معرّف الصفحة). */
  pageTitle: string;
  /** العنوان المخصّص فقط ('' = لا يوجد) — قيمة حقل التحرير تبدأ منه لا من المعرّف. */
  pageTitleCustom: string;
  onRenamePage: (title: string) => void;
}) {
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renamingPage, setRenamingPage] = React.useState(false);
  const hiddenCount = sections.filter((section) => nodeMeta[section.id]?.hidden === true).length;
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
        <Badge tone="muted">{hiddenCount > 0 ? t('easy.sectionsVisible', { visible: sections.length - hiddenCount, count: sections.length }) : t('easy.sectionsCount', { count: sections.length })}</Badge>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-1.5">
        {renamingPage ? (
          <InlineRename initial={pageTitleCustom} label={t('easy.pageTitleLabel')} t={t} onCancel={() => setRenamingPage(false)} onSave={(v) => { onRenamePage(v); setRenamingPage(false); }} />
        ) : (
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-xs text-muted" title={t('easy.pageTitleHint')}>
              {t('easy.pageTitleLabel')}: <span className="font-medium text-text">{pageTitle}</span>
            </p>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('easy.pageTitleLabel')} title={t('easy.pageTitleHint')} disabled={!canManage} onClick={() => setRenamingPage(true)}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </div>
        )}
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
              const marker = sectionMarker(section, markers);
              const metaNode = nodeMeta[section.id];
              const customName = metaNode?.name ?? null;
              const hidden = metaNode?.hidden === true;
              const shownName = customName ?? typeName;
              return (
                <li key={section.id} data-hidden={hidden ? 'true' : undefined} className={cn('group rounded-md border', selected ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-background', hidden && 'opacity-60')}>
                  {renamingId === section.id ? (
                    <InlineRename
                      initial={customName ?? ''}
                      label={t('easy.renameInputLabel')}
                      t={t}
                      onCancel={() => setRenamingId(null)}
                      onSave={(v) => { onRename(section.id, v); setRenamingId(null); }}
                    />
                  ) : (
                  <div className="flex flex-col px-1 pb-0.5">
                    <button
                      type="button"
                      onClick={() => onSelect(selectionTargetFor(section))}
                      aria-current={selected ? 'true' : undefined}
                      className="flex min-h-11 w-full min-w-0 flex-col items-start justify-center rounded px-2 text-start"
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-text" title={shownName}>{shownName}</span>
                        {hidden ? <Badge tone="muted" className="shrink-0">{t('easy.hidden')}</Badge> : null}
                        {total > 1 ? <span className="shrink-0 text-[11px] text-muted" dir="ltr">{seen}/{total}</span> : null}
                        {marker ? <IssueDot severity={marker} label={marker === 'error' ? t('issues.blocking') : t('issues.warning')} /> : null}
                      </span>
                      {customName ? <span className="w-full truncate text-xs text-muted">{typeName}</span> : summary.title ? <span className="w-full truncate text-xs text-muted">{summary.title}</span> : null}
                    </button>
                    {/* الأدوات في سطر ثانٍ: عمود البنية 240px لا يتّسع لاسم القسم وستة أزرار في سطر واحد. */}
                    <div className="flex shrink-0 items-center justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.moveUp')} disabled={!canManage || index === 0} onClick={() => onMove(section.id, 'up')}>
                        <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.moveDown')} disabled={!canManage || index === sections.length - 1} onClick={() => onMove(section.id, 'down')}>
                        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.renameSection')} disabled={!canManage} onClick={() => setRenamingId(section.id)}>
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={hidden ? t('easy.showSection') : t('easy.hideSection')} aria-pressed={hidden} disabled={!canManage} onClick={() => onToggleHidden(section.id)}>
                        {hidden ? <Eye className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.duplicate')} disabled={!canManage} onClick={() => onDuplicate(section.id)}>
                        <Copy className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button" variant="ghost" size="icon" className="h-9 w-8" aria-label={t('easy.delete')} disabled={!canManage}
                        onClick={() => onDelete(section.id, customName ?? summary.title ?? typeName)}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  )}
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
