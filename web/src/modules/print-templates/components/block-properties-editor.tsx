'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { Check, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DEFAULT_DOCUMENT_ITEMS_COLUMNS,
  DOCUMENT_BLOCK_PROPERTY_CONTRACT,
  DOCUMENT_ITEMS_COLUMN_IDS,
  getDocumentTypeDefinition,
} from '@/modules/documents/registry/document-types';
import type {
  DocBlockAlignment,
  DocBlockFontSize,
  DocBlockImageOpacity,
  DocBlockImageSize,
  DocItemsColumn,
  DocItemsColumnId,
  DocSectionKey,
  DocSectionLayoutItem,
  DocSectionProperties,
  DocumentTypeId,
} from '@/modules/documents/types';

const REQUIRED_COLUMNS: readonly DocItemsColumnId[] = ['description', 'total'];

/** مؤشر موضعي بصري لخيارات محاذاة الصورة؛ النص المجاور هو المصدر الميسّر للمعنى. */
function ImagePositionMarker({ alignment }: { alignment: DocBlockAlignment | undefined }) {
  if (alignment === undefined) {
    return (
      <span aria-hidden="true" className="flex h-4 w-full items-center justify-between border-y border-current/25 px-1">
        <span className="h-1.5 w-4 rounded-full bg-current" />
        <span className="h-1.5 w-4 rounded-full bg-current" />
      </span>
    );
  }

  const linePosition = alignment === 'center' ? 'mx-auto' : alignment === 'end' ? 'ms-auto' : 'me-auto';
  return (
    <span aria-hidden="true" className="flex h-4 w-full items-center border-y border-current/25 px-1">
      <span className={cn('h-1.5 w-7 rounded-full bg-current', linePosition)} />
    </span>
  );
}

function withoutEmptyProperties(properties: DocSectionProperties): DocSectionProperties | undefined {
  const next = Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined)) as DocSectionProperties;
  return Object.keys(next).length > 0 ? next : undefined;
}

function SortableItemsColumnEditor({
  column,
  label,
  onChange,
  onMove,
  isFirst,
  isLast,
  disabled,
}: {
  column: DocItemsColumn;
  label: string;
  onChange: (changes: Partial<DocItemsColumn>) => void;
  onMove: (direction: 'up' | 'down') => void;
  isFirst: boolean;
  isLast: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('printTemplateStudio');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded border border-border p-2',
        isDragging && 'z-10 opacity-60 shadow-md',
      )}
    >
      <div className="flex flex-col items-center gap-0.5 pt-0.5">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('drag_column', { column: label })}
          className="cursor-grab touch-none rounded p-1 text-muted focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:opacity-40"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={disabled || isFirst}
          onClick={() => onMove('up')}
          aria-label={t('move_column_up', { column: label })}
          className="rounded p-1 text-muted hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={disabled || isLast}
          onClick={() => onMove('down')}
          aria-label={t('move_column_down', { column: label })}
          className="rounded p-1 text-muted hover:bg-primary-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="space-y-1">
          <Label htmlFor={`template-column-label-${column.id}`} className="text-xs text-muted">{t('column_label', { column: label })}</Label>
          <Input id={`template-column-label-${column.id}`} value={column.label ?? ''} disabled={disabled} maxLength={80} placeholder={label} onChange={(event) => onChange({ label: event.target.value || undefined })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`template-column-alignment-${column.id}`} className="text-xs text-muted">{t('alignment')}</Label>
          <Select id={`template-column-alignment-${column.id}`} value={column.alignment ?? ''} disabled={disabled} onChange={(event) => onChange({ alignment: (event.target.value || undefined) as DocBlockAlignment | undefined })}>
            <option value="">{t('inherit_default')}</option>
            <option value="start">{t('alignment_start')}</option>
            <option value="center">{t('alignment_center')}</option>
            <option value="end">{t('alignment_end')}</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** محرر خصائص الكتل؛ لا يعرض إلا المفاتيح التي يستطيع السجل والعارض استهلاكها. */
export function BlockPropertiesEditor({
  value,
  onChange,
  documentType,
  disabled,
}: {
  value: DocSectionLayoutItem[];
  onChange: (layout: DocSectionLayoutItem[]) => void;
  documentType: DocumentTypeId;
  disabled?: boolean;
}) {
  const t = useTranslations('printTemplateStudio');
  const tSections = useTranslations('documentSections');
  const tInvoice = useTranslations('invoiceDoc');
  const typeDefinition = getDocumentTypeDefinition(documentType);
  const editableBlocks = useMemo(
    () => value.filter((item) => typeDefinition.allowedBlocks.includes(item.key) && DOCUMENT_BLOCK_PROPERTY_CONTRACT[item.key].length > 0),
    [typeDefinition.allowedBlocks, value],
  );
  const [selectedKey, setSelectedKey] = useState<DocSectionKey | null>(editableBlocks[0]?.key ?? null);

  useEffect(() => {
    if (!selectedKey || !editableBlocks.some((item) => item.key === selectedKey)) setSelectedKey(editableBlocks[0]?.key ?? null);
  }, [editableBlocks, selectedKey]);

  const selected = editableBlocks.find((item) => item.key === selectedKey) ?? null;
  if (!selected) return null;
  const allowed = DOCUMENT_BLOCK_PROPERTY_CONTRACT[selected.key];
  const properties = selected.properties ?? {};
  const isImageBlock = selected.key === 'stamp' || selected.key === 'signature';
  const imagePositionOptions: Array<{ value: DocBlockAlignment | undefined; label: string }> = [
    { value: undefined, label: t('inherit_default') },
    { value: 'start', label: t('alignment_start') },
    { value: 'center', label: t('alignment_center') },
    { value: 'end', label: t('alignment_end') },
  ];
  const imagePositionLabel = imagePositionOptions.find((option) => option.value === properties.alignment)?.label ?? t('inherit_default');
  const update = (changes: Partial<DocSectionProperties>) => {
    const nextProperties = withoutEmptyProperties({ ...properties, ...changes });
    onChange(value.map((item) => item.key === selected.key ? { ...item, properties: nextProperties } : item));
  };

  const columnLabels: Record<DocItemsColumnId, string> = {
    number: '#',
    product: tInvoice('product'),
    description: tInvoice('description'),
    product_code: tInvoice('product_code'),
    barcode: tInvoice('barcode'),
    quantity: tInvoice('qty'),
    price_before_tax: tInvoice('price_before_tax'),
    unit_price: tInvoice('unit_price'),
    tax: tInvoice('tax'),
    total: tInvoice('total'),
  };
  const columns: readonly DocItemsColumn[] = properties.columns ?? DEFAULT_DOCUMENT_ITEMS_COLUMNS.map((id) => ({ id }));
  const columnFor = (id: DocItemsColumnId) => columns.find((column) => column.id === id);
  const toggleColumn = (id: DocItemsColumnId) => {
    const current = columnFor(id);
    if (current) {
      if (REQUIRED_COLUMNS.includes(id)) return;
      update({ columns: columns.filter((column) => column.id !== id) });
      return;
    }
    update({ columns: [...columns, { id }] });
  };
  const updateColumn = (id: DocItemsColumnId, changes: Partial<DocItemsColumn>) => {
    update({ columns: columns.map((column) => column.id === id ? { ...column, ...changes } : column) });
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorderColumns = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length) return;
    update({ columns: arrayMove([...columns], from, to) });
  };
  const onColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderColumns(
      columns.findIndex((column) => column.id === active.id),
      columns.findIndex((column) => column.id === over.id),
    );
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <p className="text-xs font-medium text-text">{t('block_properties')}</p>
        <p className="mt-1 text-xs text-muted">{t('block_properties_hint')}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="template-property-block">{t('property_block')}</Label>
        <Select id="template-property-block" value={selected.key} disabled={disabled} onChange={(event) => setSelectedKey(event.target.value as DocSectionKey)}>
          {editableBlocks.map((item) => <option key={item.key} value={item.key}>{tSections(item.key)}</option>)}
        </Select>
      </div>

      {(allowed.includes('alignment') || allowed.includes('font_size') || allowed.includes('image_size') || allowed.includes('image_opacity')) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allowed.includes('alignment') && !isImageBlock && (
            <div className="space-y-1.5">
              <Label htmlFor="template-block-alignment">{t('alignment')}</Label>
              <Select id="template-block-alignment" value={properties.alignment ?? ''} disabled={disabled} onChange={(event) => update({ alignment: (event.target.value || undefined) as DocBlockAlignment | undefined })}>
                <option value="">{t('inherit_default')}</option>
                <option value="start">{t('alignment_start')}</option>
                <option value="center">{t('alignment_center')}</option>
                <option value="end">{t('alignment_end')}</option>
              </Select>
            </div>
          )}
          {allowed.includes('alignment') && isImageBlock && (
            <fieldset className="space-y-2 sm:col-span-2" aria-describedby="template-block-image-position-feedback">
              <legend className="text-sm font-medium text-text">{t('image_position')}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {imagePositionOptions.map((option) => {
                  const checked = properties.alignment === option.value;
                  return (
                    <label key={option.value ?? 'default'} className={cn('min-w-0 cursor-pointer', disabled && 'cursor-not-allowed opacity-60')}>
                      <input
                        type="radio"
                        name="template-block-image-alignment"
                        value={option.value ?? ''}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => update({ alignment: option.value })}
                        className="peer sr-only"
                      />
                      <span className={cn(
                        'flex min-h-11 flex-col justify-center gap-1.5 rounded border px-2 py-1.5 text-center text-xs transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40',
                        checked ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:border-muted',
                      )}>
                        <ImagePositionMarker alignment={option.value} />
                        <span className="font-medium">{option.label}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p id="template-block-image-position-feedback" aria-live="polite" className="text-xs leading-relaxed text-muted">
                {t('image_position_feedback', { position: imagePositionLabel })}
              </p>
            </fieldset>
          )}
          {allowed.includes('font_size') && (
            <div className="space-y-1.5">
              <Label htmlFor="template-block-font-size">{t('font_size')}</Label>
              <Select id="template-block-font-size" value={properties.font_size ?? ''} disabled={disabled} onChange={(event) => update({ font_size: (event.target.value || undefined) as DocBlockFontSize | undefined })}>
                <option value="">{t('inherit_default')}</option>
                <option value="sm">{t('font_size_sm')}</option>
                <option value="md">{t('font_size_md')}</option>
                <option value="lg">{t('font_size_lg')}</option>
              </Select>
            </div>
          )}
          {allowed.includes('image_size') && (
            <div className="space-y-1.5">
              <Label htmlFor="template-block-image-size">{t('image_size')}</Label>
              <Select id="template-block-image-size" value={properties.image_size ?? ''} disabled={disabled} onChange={(event) => update({ image_size: (event.target.value || undefined) as DocBlockImageSize | undefined })}>
                <option value="">{t('inherit_default')}</option>
                <option value="sm">{t('image_size_sm')}</option>
                <option value="md">{t('image_size_md')}</option>
                <option value="lg">{t('image_size_lg')}</option>
              </Select>
            </div>
          )}
          {allowed.includes('image_opacity') && (
            <div className="space-y-1.5">
              <Label htmlFor="template-block-image-opacity">{t('image_opacity')}</Label>
              <Select id="template-block-image-opacity" value={properties.image_opacity ?? ''} disabled={disabled} onChange={(event) => update({ image_opacity: (event.target.value || undefined) as DocBlockImageOpacity | undefined })}>
                <option value="">{t('inherit_default')}</option>
                <option value="solid">{t('image_opacity_solid')}</option>
                <option value="soft">{t('image_opacity_soft')}</option>
                <option value="faint">{t('image_opacity_faint')}</option>
              </Select>
            </div>
          )}
        </div>
      )}

      {allowed.includes('static_content') && (
        <div className="space-y-1.5">
          <Label htmlFor="template-static-content">{t('static_content')}</Label>
          <textarea
            id="template-static-content"
            rows={3}
            disabled={disabled}
            maxLength={2000}
            value={properties.static_content ?? ''}
            onChange={(event) => update({ static_content: event.target.value || undefined })}
            placeholder={t('static_content_placeholder')}
            className="min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      )}

      {allowed.includes('columns') && (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-text">{t('items_columns')}</p>
            <p className="mt-1 text-xs text-muted">{t('items_columns_hint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {DOCUMENT_ITEMS_COLUMN_IDS.map((id) => {
              const enabled = Boolean(columnFor(id));
              const required = REQUIRED_COLUMNS.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled || required}
                  aria-pressed={enabled}
                  onClick={() => toggleColumn(id)}
                  className={cn(
                    'flex min-h-9 items-center gap-1.5 rounded border px-2 py-1.5 text-start text-xs focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60',
                    enabled ? 'border-primary bg-primary-soft text-primary' : 'border-border text-muted hover:border-primary hover:text-primary',
                  )}
                >
                  {enabled && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  <span>{columnLabels[id]}</span>
                  {required && <span className="ms-auto text-[10px] text-muted">{t('required_column')}</span>}
                </button>
              );
            })}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColumnDragEnd}>
            <SortableContext items={columns.map((column) => column.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {columns.map((column, index) => (
                  <SortableItemsColumnEditor
                    key={column.id}
                    column={column}
                    label={columnLabels[column.id]}
                    onChange={(changes) => updateColumn(column.id, changes)}
                    onMove={(direction) => reorderColumns(index, direction === 'up' ? index - 1 : index + 1)}
                    isFirst={index === 0}
                    isLast={index === columns.length - 1}
                    disabled={disabled}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
