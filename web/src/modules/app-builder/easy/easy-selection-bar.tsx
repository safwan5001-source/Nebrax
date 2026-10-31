'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * شريط القسم المحدد (مواصفة V2 §4.1): ما إن يضغط التاجر عنصراً في المعاينة يظهر شريط بإجراءات القسم الحاوي له —
 * أعلى/أسفل/تكرار/حذف. الإخفاء/الإظهار يكتب في بيانات المحرر (AD-05) لا في المخطط: القسم المخفي يبقى في المسودة ويُسقَط من المعاينة والنشر.
 */
export function EasySelectionBar({
  name, position, canManage, hidden, onToggleHidden, onMoveUp, onMoveDown, onDuplicate, onDelete, t,
}: {
  name: string;
  position: { index: number; count: number };
  canManage: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  t: Translate;
}) {
  return (
    <div role="toolbar" aria-label={t('easy.selectionBar.label', { name })} data-testid="easy-selection-bar"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-surface px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
        {name} <span className="text-muted" dir="ltr">{position.index + 1}/{position.count}</span>
      </span>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={t('easy.selectionBar.up')} disabled={!canManage || position.index === 0} onClick={onMoveUp}>
        <ArrowUp className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={t('easy.selectionBar.down')} disabled={!canManage || position.index === position.count - 1} onClick={onMoveDown}>
        <ArrowDown className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={t('easy.selectionBar.duplicate')} disabled={!canManage} onClick={onDuplicate}>
        <Copy className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={hidden ? t('easy.selectionBar.show') : t('easy.selectionBar.hide')} aria-pressed={hidden} title={t('easy.selectionBar.hideReason')} disabled={!canManage} onClick={onToggleHidden}>
        {hidden ? <Eye className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> : <EyeOff className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={t('easy.selectionBar.delete')} disabled={!canManage} onClick={onDelete}>
        <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </Button>
    </div>
  );
}
