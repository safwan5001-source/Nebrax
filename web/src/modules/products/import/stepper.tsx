'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepDefinition {
  key: string;
  label: string;
}

/**
 * شريط خطوات مضغوط للتدفّقات متعدّدة المراحل.
 *
 * على الجوال يبقى سطراً واحداً ممرَّراً أفقياً **داخل حاويته** لا على مستوى
 * الصفحة، ويُسبَق بسطر «الخطوة ٣ من ٧» كي يبقى الموضع معلوماً حتى لو خرجت
 * بقية الخطوات عن الشاشة.
 *
 * **تمرير الخطوة النشطة تلقائياً إلى منظور المستخدم** (مراجعة إنتاج/جوال):
 * `overflow-x-auto` وحده لا يكفي — بلا هذا، شاشةٌ ضيّقة (iPhone) تُبقي تمرير
 * الحاوية عند نقطة بدايته (الخطوة الأولى) ما لم يسحب المستخدم يدوياً، فتبدو
 * الخطوات اللاحقة (٣، ٤) مقطوعةً أو مخفيّة تماماً رغم أن العنصر موجودٌ فعلاً
 * ويمكن الوصول إليه بالتمرير — وهذا بالضبط ما رُصد إنتاجياً. الحل: مرّر
 * الخطوة النشطة إلى المنتصف تلقائياً كلما تغيّرت `current`، بلا أي عنصر
 * تصميمٍ جديد.
 */
export function Stepper({
  steps,
  current,
  onSelect,
  className,
  label,
}: {
  steps: StepDefinition[];
  current: number;
  onSelect?: (index: number) => void;
  className?: string;
  label: string;
}) {
  const listRef = React.useRef<HTMLOListElement | null>(null);
  const activeRef = React.useRef<HTMLLIElement | null>(null);

  React.useEffect(() => {
    // `scrollIntoView` غائبة عن jsdom وعن بعض بيئات العرض الأقدم — تصريحٌ
    // دفاعي، لا مجرّد التفاف حول الاختبار.
    if (typeof activeRef.current?.scrollIntoView === 'function') {
      activeRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  return (
    <nav aria-label={label} className={cn('rounded border border-border bg-surface', className)}>
      <ol ref={listRef} className="flex items-center gap-1 overflow-x-auto p-2">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const reachable = index <= current && Boolean(onSelect);

          return (
            <li key={step.key} ref={active ? activeRef : undefined} className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={reachable ? () => onSelect?.(index) : undefined}
                disabled={!reachable}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-h-9 items-center gap-2 rounded px-2.5 py-1.5 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                  active && 'bg-primary-soft font-medium text-primary',
                  !active && done && 'text-text hover:bg-primary-soft/50',
                  !active && !done && 'text-muted',
                  reachable ? 'cursor-pointer' : 'cursor-default'
                )}
              >
                <span
                  className={cn(
                    'num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                    active ? 'border-primary text-primary' : done ? 'border-primary bg-primary text-white' : 'border-border text-muted'
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={2} /> : index + 1}
                </span>
                <span className="whitespace-nowrap">{step.label}</span>
              </button>
              {index < steps.length - 1 ? (
                <span className="h-px w-4 shrink-0 bg-border" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
