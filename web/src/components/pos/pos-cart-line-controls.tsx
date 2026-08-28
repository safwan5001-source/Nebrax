'use client';

import type { ReactNode } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { PosNumericEditor } from '@/components/pos/pos-numeric-editor';
import { cn } from '@/lib/utils';

type NumericEditorLabels = {
  apply: string;
  backspace: string;
  cancel: string;
  clear: string;
  decimal: string;
  digit: (digit: string) => string;
  value: string;
};

/** إطار سطر السلة: التحديد باللمس دون تغيير منطق الكمية أو الحذف. */
export function PosCartLineFrame({
  selected,
  scanned,
  onSelect,
  register,
  children,
}: {
  selected: boolean;
  scanned: boolean;
  onSelect: () => void;
  register?: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={register}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onFocus={onSelect}
      className={cn(
        'flex gap-2 border-b py-3 outline-none last:border-0',
        'transition-colors motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-primary/40',
        scanned || selected ? 'border-primary bg-primary-soft' : 'border-border',
      )}
    >
      {children}
    </div>
  );
}

export function PosCartRemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="ms-2 grid min-h-12 min-w-12 shrink-0 touch-manipulation place-items-center rounded-md text-muted hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      aria-label={label}
    >
      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}

/** أزرار كمية لمس كبيرة تستدعي مسار setQty القائم. */
export function PosCartQtyControls({
  qty,
  decreaseLabel,
  increaseLabel,
  quantityLabel,
  keypadTitle,
  showKeypad,
  labels,
  onDecrease,
  onIncrease,
  onQtyChange,
}: {
  qty: number;
  decreaseLabel: string;
  increaseLabel: string;
  quantityLabel: string;
  keypadTitle: string;
  showKeypad: boolean;
  labels: NumericEditorLabels;
  onDecrease: () => void;
  onIncrease: () => void;
  onQtyChange: (value: string) => void;
}) {
  return (
    <div
      className="flex min-h-12 items-center rounded-md border border-border bg-background"
    >
      <button
        type="button"
        onClick={onDecrease}
        className="grid min-h-12 min-w-12 touch-manipulation place-items-center text-text hover:bg-primary-soft hover:text-primary active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={decreaseLabel}
      >
        <Minus className="h-4 w-4" strokeWidth={1.7} />
      </button>
      <PosNumericEditor
        allowDecimal={false}
        className="h-12 min-w-12 text-sm font-semibold"
        inputAriaLabel={quantityLabel}
        labels={labels}
        onChange={onQtyChange}
        showKeypad={showKeypad}
        title={keypadTitle}
        value={String(qty)}
      />
      <button
        type="button"
        onClick={onIncrease}
        className="grid min-h-12 min-w-12 touch-manipulation place-items-center text-text hover:bg-primary-soft hover:text-primary active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={increaseLabel}
      >
        <Plus className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </div>
  );
}
