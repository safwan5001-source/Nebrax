'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DOCUMENT_BLOCK_PROPERTY_CONTRACT,
  DOCUMENT_ITEMS_COLUMN_IDS,
  getDocumentTypeDefinition,
} from '@/modules/documents/registry/document-types';
import type {
  DocBlockAlignment,
  DocBlockFontSize,
  DocItemsColumn,
  DocItemsColumnId,
  DocSectionKey,
  DocSectionLayoutItem,
  DocSectionProperties,
  DocumentTypeId,
} from '@/modules/documents/types';

const REQUIRED_COLUMNS: readonly DocItemsColumnId[] = ['description', 'total'];

function withoutEmptyProperties(properties: DocSectionProperties): DocSectionProperties | undefined {
  const next = Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined)) as DocSectionProperties;
  return Object.keys(next).length > 0 ? next : undefined;
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
  const update = (changes: Partial<DocSectionProperties>) => {
    const nextProperties = withoutEmptyProperties({ ...properties, ...changes });
    onChange(value.map((item) => item.key === selected.key ? { ...item, properties: nextProperties } : item));
  };

  const columnLabels: Record<DocItemsColumnId, string> = {
    number: '#',
    description: tInvoice('description'),
    quantity: tInvoice('qty'),
    unit_price: tInvoice('unit_price'),
    tax: tInvoice('tax'),
    total: tInvoice('total'),
  };
  const columns: readonly DocItemsColumn[] = properties.columns ?? DOCUMENT_ITEMS_COLUMN_IDS.map((id) => ({ id }));
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

      {(allowed.includes('alignment') || allowed.includes('font_size')) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allowed.includes('alignment') && (
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
          <div className="space-y-2">
            {columns.map((column) => (
              <div key={column.id} className="grid grid-cols-1 gap-2 rounded border border-border p-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div className="space-y-1">
                  <Label htmlFor={`template-column-label-${column.id}`} className="text-xs text-muted">{t('column_label', { column: columnLabels[column.id] })}</Label>
                  <Input id={`template-column-label-${column.id}`} value={column.label ?? ''} disabled={disabled} maxLength={80} placeholder={columnLabels[column.id]} onChange={(event) => updateColumn(column.id, { label: event.target.value || undefined })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`template-column-alignment-${column.id}`} className="text-xs text-muted">{t('alignment')}</Label>
                  <Select id={`template-column-alignment-${column.id}`} value={column.alignment ?? ''} disabled={disabled} onChange={(event) => updateColumn(column.id, { alignment: (event.target.value || undefined) as DocBlockAlignment | undefined })}>
                    <option value="">{t('inherit_default')}</option>
                    <option value="start">{t('alignment_start')}</option>
                    <option value="center">{t('alignment_center')}</option>
                    <option value="end">{t('alignment_end')}</option>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
