'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical, Eye, EyeOff, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { DocSectionKey, DocSectionLayoutItem } from '@/modules/documents/types';

function Row({
  item,
  onToggle,
  onMove,
  index,
  count,
  required,
  disabled,
}: {
  item: DocSectionLayoutItem;
  onToggle: (key: DocSectionKey) => void;
  onMove: (key: DocSectionKey, direction: 'up' | 'down') => void;
  index: number;
  count: number;
  required: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('documentSections');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, disabled });
  const interactionDisabled = disabled || required;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5', isDragging && 'opacity-60 shadow-md')}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          disabled={disabled || index === 0}
          onClick={() => onMove(item.key, 'up')}
          aria-label={t('move_up', { section: t(item.key) })}
          className="rounded p-1 text-muted hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={disabled || index === count - 1}
          onClick={() => onMove(item.key, 'down')}
          aria-label={t('move_down', { section: t(item.key) })}
          className="rounded p-1 text-muted hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-label={t('drag')}
        className="cursor-grab touch-none rounded p-1 text-muted focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-40"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      </button>
      <span className={cn('flex-1 text-sm', item.visible ? 'text-text' : 'text-muted line-through')}>{t(item.key)}</span>
      {required && <span className="text-[11px] text-muted">{t('required')}</span>}
      <button
        type="button"
        disabled={interactionDisabled}
        onClick={() => onToggle(item.key)}
        aria-pressed={item.visible}
        aria-label={item.visible ? t('hide', { section: t(item.key) }) : t('show', { section: t(item.key) })}
        className="rounded p-1 text-muted hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {item.visible ? <Eye className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> : <EyeOff className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
      </button>
    </div>
  );
}

/**
 * محرر كتل المستند — يرتب الكتل ويسمح بإظهار الاختيارية فقط. يسحب عقد النوع
 * إلى الواجهة كي لا يعرض خياراً سيرفضه الخادم لاحقاً، بينما يبقى تحقق الخادم
 * المصدر الحاسم عند الحفظ والنشر.
 */
export function SectionDesigner({
  value,
  onChange,
  allowedBlocks,
  requiredBlocks,
  disabled,
}: {
  value: DocSectionLayoutItem[];
  onChange: (v: DocSectionLayoutItem[]) => void;
  allowedBlocks?: readonly DocSectionKey[];
  requiredBlocks?: readonly DocSectionKey[];
  disabled?: boolean;
}) {
  const t = useTranslations('documentSections');
  const [query, setQuery] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const required = requiredBlocks ?? [];
  const allowed = allowedBlocks ?? value.map((item) => item.key);
  const available = allowed.filter((key) => !value.some((item) => item.key === key));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleItems = normalizedQuery
    ? value.filter((item) => t(item.key).toLocaleLowerCase().includes(normalizedQuery))
    : value;
  const visibleAvailable = normalizedQuery
    ? available.filter((key) => t(key).toLocaleLowerCase().includes(normalizedQuery))
    : available;

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = value.findIndex((v) => v.key === active.id);
    const newIndex = value.findIndex((v) => v.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(value, oldIndex, newIndex));
  }

  const toggle = (key: DocSectionKey) =>
    onChange(value.map((v) => (v.key === key ? { ...v, visible: !v.visible } : v)));

  const move = (key: DocSectionKey, direction: 'up' | 'down') => {
    const currentIndex = value.findIndex((item) => item.key === key);
    const nextIndex = currentIndex + (direction === 'up' ? -1 : 1);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= value.length) return;
    onChange(arrayMove(value, currentIndex, nextIndex));
  };

  const add = (key: DocSectionKey) => onChange([...value, { key, visible: true }]);

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="document-section-search" className="text-xs font-medium text-muted">{t('search')}</label>
        <Input id="document-section-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search_placeholder')} disabled={disabled} />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleItems.map((v) => v.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {visibleItems.map((item) => {
              const index = value.findIndex((candidate) => candidate.key === item.key);
              return (
              <Row
                key={item.key}
                item={item}
                onToggle={toggle}
                onMove={move}
                index={index}
                count={value.length}
                required={required.includes(item.key)}
                disabled={disabled}
              />
              );
            })}
            {visibleItems.length === 0 && <p className="rounded border border-dashed border-border px-3 py-2 text-sm text-muted">{t('search_empty')}</p>}
          </div>
        </SortableContext>
      </DndContext>

      {visibleAvailable.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-text">{t('available')}</p>
          <div className="flex flex-wrap gap-1.5">
            {visibleAvailable.map((key) => (
              <button
                key={key}
                type="button"
                disabled={disabled}
                onClick={() => add(key)}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                {t('add', { section: t(key) })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
