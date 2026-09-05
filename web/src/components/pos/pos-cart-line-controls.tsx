'use client';

import type { ReactNode } from 'react';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
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
  disabled = false,
}: {
  label: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="grid min-h-12 min-w-12 shrink-0 touch-manipulation place-items-center rounded-md text-muted hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
      aria-label={label}
    >
      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}

/**
 * أزرار كمية لمس كبيرة تستدعي مسار setQty القائم. `disabled` (PR-3: شريط
 * التحكم السفلي) يعطّل الأزرار حين لا يوجد سطر محدَّد — حالة آمنة حاسمة، لا
 * تعديل صامت لسطر عشوائي.
 */
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
  disabled = false,
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
  disabled?: boolean;
}) {
  return (
    <div
      className="flex min-h-12 items-center rounded-md border border-border bg-background"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onDecrease}
        className="grid min-h-12 min-w-12 touch-manipulation place-items-center text-text hover:bg-primary-soft hover:text-primary active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text"
        aria-label={decreaseLabel}
      >
        <Minus className="h-4 w-4" strokeWidth={1.7} />
      </button>
      <PosNumericEditor
        allowDecimal={false}
        className="h-12 min-w-12 text-sm font-semibold"
        disabled={disabled}
        inputAriaLabel={quantityLabel}
        labels={labels}
        onChange={onQtyChange}
        showKeypad={showKeypad}
        title={keypadTitle}
        value={String(qty)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={onIncrease}
        className="grid min-h-12 min-w-12 touch-manipulation place-items-center text-text hover:bg-primary-soft hover:text-primary active:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text"
        aria-label={increaseLabel}
      >
        <Plus className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </div>
  );
}

/** حالة السلة الفارغة: مضغوطة وهادئة، بلا مساحة ميتة أو صندوق أيقونة ملوّن. */
export function PosCartEmptyState({ message }: { message: string }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-3 py-6 text-center"
      data-testid="pos-cart-empty"
    >
      <ShoppingCart className="h-5 w-5 text-muted" strokeWidth={1.7} aria-hidden />
      <p className="max-w-[16rem] text-sm text-muted">{message}</p>
    </div>
  );
}
