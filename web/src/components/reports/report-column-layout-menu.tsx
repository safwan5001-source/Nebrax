'use client';

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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Columns3, GripVertical } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

export interface ReportColumnLayoutItem {
  id: string;
  label: string;
  visible: boolean;
  canHide: boolean;
}

export interface ReportColumnLayoutLabels {
  columns: string;
  moveColumn: string;
  moveUp: string;
  moveDown: string;
}

function SortableColumnRow({
  item,
  index,
  count,
  labels,
  onMove,
  onVisibilityChange,
  menuOpen,
}: {
  item: ReportColumnLayoutItem;
  index: number;
  count: number;
  labels: ReportColumnLayoutLabels;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onVisibilityChange: (id: string, visible: boolean) => void;
  menuOpen: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex min-h-10 items-center gap-1 rounded px-1.5 text-sm text-text hover:bg-primary-soft/50', isDragging && 'z-10 opacity-60 shadow-sm')}
    >
      <button
        type="button"
        aria-label={`${labels.moveUp}: ${item.label}`}
        tabIndex={menuOpen ? 0 : -1}
        disabled={index === 0}
        onClick={() => onMove(item.id, 'up')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`${labels.moveDown}: ${item.label}`}
        tabIndex={menuOpen ? 0 : -1}
        disabled={index === count - 1}
        onClick={() => onMove(item.id, 'down')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={`${labels.moveColumn}: ${item.label}`}
        className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded text-muted active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        {...attributes}
        {...listeners}
        tabIndex={menuOpen ? 0 : -1}
      >
        <GripVertical className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
      </button>
      {item.canHide ? (
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1">
          <input
            type="checkbox"
            tabIndex={menuOpen ? 0 : -1}
            checked={item.visible}
            onChange={(event) => onVisibilityChange(item.id, event.target.checked)}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          <span className={cn('truncate', !item.visible && 'text-muted')}>{item.label}</span>
        </label>
      ) : <span className="min-w-0 flex-1 truncate px-1 font-medium">{item.label}</span>}
    </div>
  );
}

export function ReportColumnLayoutMenu({
  items,
  labels,
  onReorder,
  onVisibilityChange,
}: {
  items: ReportColumnLayoutItem[];
  labels: ReportColumnLayoutLabels;
  onReorder: (order: string[]) => void;
  onVisibilityChange: (id: string, visible: boolean) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function move(id: string, direction: 'up' | 'down') {
    const index = items.findIndex((item) => item.id === id);
    const target = index + (direction === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= items.length) return;
    onReorder(arrayMove(items.map((item) => item.id), index, target));
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = items.findIndex((item) => item.id === event.active.id);
    const newIndex = items.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(items.map((item) => item.id), oldIndex, newIndex));
  }

  return (
    <Dropdown
      trigger={<><Columns3 className="h-4 w-4" strokeWidth={1.7} /><span>{labels.columns}</span></>}
      menuLabel={labels.columns}
      triggerLabel={labels.columns}
      popupRole="dialog"
      triggerClassName="h-9 gap-2 border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-primary-soft"
      menuClassName="min-w-72 p-2"
      >
        {({ open }) => (
          <div aria-hidden={!open}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {items.map((item, index) => (
                    <SortableColumnRow
                      key={item.id}
                      item={item}
                      index={index}
                      count={items.length}
                      labels={labels}
                      onMove={move}
                      onVisibilityChange={onVisibilityChange}
                      menuOpen={open}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </Dropdown>
  );
}
