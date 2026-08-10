'use client';

import { useTranslations } from 'next-intl';
import { Building2, Network } from 'lucide-react';
import { useBranches } from '@/lib/branch';
import type { BranchView } from '@/lib/branch-view';
import { cn } from '@/lib/utils';

/**
 * مبدّل نطاق القائمة: **الفرع النشط** (الافتراضي) ↔ **كل الفروع**.
 *
 * ظاهر في الشاشة نفسها لا مخفيّ في إعدادات، ومتاح لكل مستخدم من أي فرع.
 * يختفي كلياً حين يكون للمؤسسة فرع واحد — لا معنى لخيار بلا بديل.
 *
 * المستندات المحاسبية موسومة بالفرع بلا Scope عالمي، فهذا المبدّل يحكم
 * **العرض** وحده ولا يمسّ التقارير المجمّعة ولا الدفاتر.
 */
export function BranchViewToggle({
  value,
  onChange,
  className,
}: {
  value: BranchView;
  onChange: (next: BranchView) => void;
  className?: string;
}) {
  const t = useTranslations('branchView');
  const { branches, active } = useBranches();

  // فرع واحد (أو لا فروع) ⇒ لا خيار حقيقي، فلا يُعرض المبدّل.
  if (branches.length < 2) return null;

  // اسم الفرع النشط أوضح من «الفرع الحالي» — فيعرف المستخدم **أيّ** فرع يرى.
  const currentLabel = active?.name ?? t('current');

  const item = (view: BranchView, label: string, Icon: typeof Building2) => {
    const on = value === view;
    return (
      <button
        type="button"
        onClick={() => onChange(view)}
        aria-pressed={on}
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
          on ? 'bg-primary-soft text-primary' : 'text-muted hover:text-text'
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="max-w-32 truncate">{label}</span>
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label={t('label')}
      className={cn('inline-flex overflow-hidden rounded border border-border bg-surface', className)}
    >
      {item('current', currentLabel, Building2)}
      <span aria-hidden className="w-px bg-border" />
      {item('all', t('all'), Network)}
    </div>
  );
}
