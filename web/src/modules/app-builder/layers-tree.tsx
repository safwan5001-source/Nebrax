'use client';

import * as React from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { type AppSchemaComponent } from '@/lib/app-builder';

/**
 * APP-BUILDER-6 — شجرة الطبقات: التحديد كما بُني في APP-BUILDER-5، زائداً إعادة
 * ترتيب **محدودة بالإخوة فقط** (لا نقل بين آباء مختلفين) عبر مقبض سحب و`@dnd-kit`
 * (تبعية قائمة، النمط نفسه المُثبَت في `section-designer.tsx`) وزرَّي أعلى/أسفل
 * كبديل يعمل بلوحة المفاتيح. انظر `APP-BUILDER-6-UX-EVIDENCE-PASS.md`.
 */

function nodeLabel(node: AppSchemaComponent): string | null {
  return typeof node.props?.title === 'string' && node.props.title
    ? node.props.title
    : typeof node.props?.text === 'string' && node.props.text
      ? node.props.text
      : typeof node.props?.label === 'string' && node.props.label
        ? node.props.label
        : null;
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  index,
  count,
  onMove,
  reorderable,
}: {
  node: AppSchemaComponent;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  index: number;
  count: number;
  onMove: (id: string, direction: 'up' | 'down') => void;
  reorderable: boolean;
}) {
  const t = useTranslations('appBuilder.builder');
  const selected = node.id === selectedId;
  const label = nodeLabel(node);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id, disabled: !reorderable });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex min-h-8 items-center gap-1', isDragging && 'opacity-60')}
    >
      {reorderable ? (
        <div className="flex shrink-0 items-center gap-0.5" style={{ marginInlineStart: `${depth * 16}px` }}>
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(node.id, 'up')}
            aria-label={t('moveUpLabel')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            onClick={() => onMove(node.id, 'down')}
            aria-label={t('moveDownLabel')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('dragLabel')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <span style={{ width: `${depth * 16}px` }} className="shrink-0" />
      )}
      <div
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(node.id);
          }
        }}
        className={cn(
          'flex min-h-8 flex-1 cursor-pointer items-center gap-1.5 rounded pe-2 text-sm outline-none',
          selected ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-background'
        )}
      >
        <span className="shrink-0 text-xs text-muted">{node.type}</span>
        {label ? <span className="truncate text-xs text-muted">· {label}</span> : null}
      </div>
    </div>
  );
}

function ChildrenGroup({
  parent,
  depth,
  selectedId,
  onSelect,
  onReorder,
  onMove,
}: {
  parent: AppSchemaComponent;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (parentId: string, orderedIds: string[]) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const children = parent.children ?? [];
  const reorderable = children.length > 1;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = children.map((c) => c.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(parent.id, arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        {children.map((child, index) => (
          <React.Fragment key={child.id}>
            <TreeRow
              node={child}
              depth={depth}
              selectedId={selectedId}
              onSelect={onSelect}
              index={index}
              count={children.length}
              onMove={onMove}
              reorderable={reorderable}
            />
            {child.children && child.children.length > 0 ? (
              <ChildrenGroup parent={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onReorder={onReorder} onMove={onMove} />
            ) : null}
          </React.Fragment>
        ))}
      </SortableContext>
    </DndContext>
  );
}

export function LayersTree({
  root,
  selectedId,
  onSelect,
  onReorder,
  onMove,
  emptyLabel,
}: {
  root: AppSchemaComponent | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (parentId: string, orderedIds: string[]) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  emptyLabel: string;
}) {
  if (!root) return <p className="px-3 py-2 text-xs text-muted">{emptyLabel}</p>;

  return (
    <div role="tree" className="space-y-0.5 py-1">
      <TreeRow node={root} depth={0} selectedId={selectedId} onSelect={onSelect} index={0} count={1} onMove={onMove} reorderable={false} />
      <ChildrenGroup parent={root} depth={1} selectedId={selectedId} onSelect={onSelect} onReorder={onReorder} onMove={onMove} />
    </div>
  );
}
