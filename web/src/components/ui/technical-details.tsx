'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTechnicalJson } from '@/lib/technical-data';

export interface TechnicalDetailsProps {
  /** عنوان القسم (مثلاً «تفاصيل تقنية»). */
  title: string;
  /** وصف اختياري يظهر تحت العنوان عند الفتح. */
  description?: string;
  /** أي قيمة تُعرض كما هي — كائن، مصفوفة، نص، null… */
  data: unknown;
  /** مطوي افتراضياً. */
  defaultOpen?: boolean;
  /** تسمية زر النسخ. */
  copyLabel?: string;
  /** تأكيد النسخ القصير. */
  copiedLabel?: string;
  /** خط أحادي للأكواد — افتراضي true. */
  monospace?: boolean;
  /** حد أقصى للارتفاع مع تمرير داخلي. */
  maxHeightClassName?: string;
  className?: string;
}

/**
 * عارض موحّد للبيانات التقنية (JSON/معرّفات/حمولات).
 * الطبقة الثانوية فقط: مطوي افتراضياً، يحافظ على المحتوى الخام، آمن للجوال.
 */
export function TechnicalDetails({
  title,
  description,
  data,
  defaultOpen = false,
  copyLabel = 'Copy',
  copiedLabel = 'Copied',
  monospace = true,
  maxHeightClassName = 'max-h-56',
  className,
}: TechnicalDetailsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const raw = formatTechnicalJson(data);

  async function copy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* الحافظة قد تُرفض في سياقات غير آمنة — العرض يبقى متاحاً */
    }
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className={cn('min-w-0 rounded border border-border bg-background', className)}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-primary marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
        {title}
      </summary>
      <div className="min-w-0 space-y-2 border-t border-border p-3">
        {description ? <p className="text-xs text-muted">{description}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {copied ? <Check className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden />}
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
        <pre
          dir="ltr"
          className={cn(
            'min-w-0 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-all rounded border border-border bg-surface p-3 text-xs text-text [overflow-wrap:anywhere]',
            maxHeightClassName,
            monospace && 'font-mono',
          )}
        >
          {raw}
        </pre>
      </div>
    </details>
  );
}
