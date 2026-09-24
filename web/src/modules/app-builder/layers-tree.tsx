'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { type AppSchemaComponent } from '@/lib/app-builder';

/**
 * APP-BUILDER-5 — شجرة طبقات القراءة فقط لصفحة واحدة. `role="tree"`/`"treeitem"`
 * حقيقيان (تصفّح بالأسهم لاحقاً حين تحتاجه شاشة كبيرة الشجرة — V1 يكتفي بالنقر/Enter
 * مطابقةً لنمط `radiogroup` الذي أرسته APP-BUILDER-4 لضبطٍ مخصّص مشابه). لا طيّ/بسط
 * اليوم — أشجار المخطط الحقيقية اليوم صفحة واحدة فارغة (`minimalSafeSchema`)، والتعقيد
 * غير مبرَّر قبل أن يوجد محتوى فعلي يستدعيه.
 */
function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: AppSchemaComponent;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = node.id === selectedId;
  const label = typeof node.props?.title === 'string' && node.props.title
    ? node.props.title
    : typeof node.props?.text === 'string' && node.props.text
      ? node.props.text
      : typeof node.props?.label === 'string' && node.props.label
        ? node.props.label
        : null;

  return (
    <>
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
        style={{ paddingInlineStart: `${depth * 16 + 8}px` }}
        className={cn(
          'flex min-h-8 cursor-pointer items-center gap-1.5 rounded pe-2 text-sm outline-none',
          selected ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-background'
        )}
      >
        <span className="shrink-0 text-xs text-muted">{node.type}</span>
        {label ? <span className="truncate text-xs text-muted">· {label}</span> : null}
      </div>
      {(node.children ?? []).map((child) => (
        <TreeRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

export function LayersTree({
  root,
  selectedId,
  onSelect,
  emptyLabel,
}: {
  root: AppSchemaComponent | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel: string;
}) {
  if (!root) return <p className="px-3 py-2 text-xs text-muted">{emptyLabel}</p>;

  return (
    <div role="tree" className="space-y-0.5 py-1">
      <TreeRow node={root} depth={0} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}
