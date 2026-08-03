'use client';

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
import { GripVertical, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DocSectionKey, DocSectionLayoutItem } from '@/modules/documents/types';

function Row({
  item,
  onToggle,
  disabled,
}: {
  item: DocSectionLayoutItem;
  onToggle: (key: DocSectionKey) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('documentSections');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-2 rounded border border-border bg-surface px-2 py-1.5', isDragging && 'opacity-60 shadow-md')}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label="سحب"
        className="cursor-grab touch-none text-muted disabled:cursor-default disabled:opacity-40"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.7} />
      </button>
      <span className={cn('flex-1 text-sm', item.visible ? 'text-text' : 'text-muted line-through')}>{t(item.key)}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(item.key)}
        aria-pressed={item.visible}
        aria-label={t(item.key)}
        className="rounded p-1 text-muted hover:bg-primary-soft hover:text-primary disabled:opacity-40"
      >
        {item.visible ? <Eye className="h-4 w-4" strokeWidth={1.7} /> : <EyeOff className="h-4 w-4" strokeWidth={1.7} />}
      </button>
    </div>
  );
}

/**
 * مصمّم أقسام المستند — سحب لإعادة الترتيب + إظهار/إخفاء كل قسم (dnd-kit).
 * القيمة مصفوفة مرتّبة {key, visible}؛ يظهر أثرها في المعاينة الحيّة فوراً.
 */
export function SectionDesigner({
  value,
  onChange,
  disabled,
}: {
  value: DocSectionLayoutItem[];
  onChange: (v: DocSectionLayoutItem[]) => void;
  disabled?: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={value.map((v) => v.key)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {value.map((item) => (
            <Row key={item.key} item={item} onToggle={toggle} disabled={disabled} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
