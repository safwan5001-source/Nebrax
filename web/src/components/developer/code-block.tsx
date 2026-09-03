'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * كتلة شيفرة — **LTR دائماً وبخط Mono** حتى داخل واجهة عربية RTL (§15/§445): الشيفرة
 * والمسارات والقيم التقنية لا تُقلب. قابلة للقراءة في الوضعين، تمرير أفقيّ عند الحاجة،
 * بلا زخرفة «طرفية». زرّ نسخ بتأكيد نجاح صريح (§14). النصّ قابل للتحديد.
 */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  /** تسمية اللغة/السياق في الترويسة (مثل cURL). */
  label?: string;
  className?: string;
}) {
  const t = useTranslations('developer.common');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // الحافظة قد تُرفض في سياق غير آمن — يبقى النصّ قابلاً للتحديد.
    }
  }

  return (
    <div className={cn('min-w-0 overflow-hidden rounded border border-border bg-surface', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-1.5">
        <span className="font-mono text-xs text-muted">{label}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-positive" strokeWidth={1.8} aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <pre dir="ltr" className="min-w-0 overflow-x-auto p-3 text-start text-xs leading-relaxed text-text">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
