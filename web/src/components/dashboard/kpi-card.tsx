'use client';

import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/charts/sparkline';
import { cn } from '@/lib/utils';

/**
 * بطاقة مؤشّر — بسطر فرعي اختياري تحت خطّ منقّط.
 *
 * السطر الفرعي هو ما يجعل بطاقة «الأداء المالي» مدمجة عمداً: الرقم الرئيسي
 * إجمالي المبيعات، وتحته صافي الدخل بعد المصروفات. جمعُهما في بطاقة واحدة
 * يمنع قراءة المبيعات وحدها على أنها ربح — وهو أكثر سوء فهم شيوعاً في لوحات
 * التحكم المحاسبية.
 */
export function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tone = 'primary',
  trend,
  trendLabel,
  sub,
  loading,
}: {
  label: string;
  value: string;
  /** «ريال» — يُعرض بحجم أصغر بجانب الرقم لا داخله. */
  unit?: string;
  icon: LucideIcon;
  tone?: 'primary' | 'positive';
  trend?: number[];
  trendLabel?: string;
  /** السطر الفرعي: عنوان + قيمة، تحت خطّ منقّط. */
  sub?: { label: string; value: string; tone?: 'positive' | 'negative' | 'muted' };
  loading?: boolean;
}) {
  // أيقونة عارية بلا صندوق ملوّن — `DESIGN_SYSTEM.md`: «لا أيقونات في صناديق
  // ملوّنة» (وردت في مبادئ التخطيط وفي «ما يجب تجنّبه» معاً). النموذج المرجعي
  // يضعها في صناديق، والنظام أَولى عند التعارض.
  const iconColor = tone === 'positive' ? 'text-positive' : 'text-muted';
  const subColor =
    sub?.tone === 'negative' ? 'text-negative' : sub?.tone === 'muted' ? 'text-muted' : 'text-positive';

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-[18px]">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted">{label}</span>
          <Icon className={cn('h-4 w-4 shrink-0', iconColor)} strokeWidth={1.7} />
        </div>

        {loading ? (
          <Skeleton className="mt-3 h-7 w-32" />
        ) : (
          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className="num text-[26px] font-bold leading-tight text-text">{value}</span>
            {unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}
          </div>
        )}

        {trend && !loading && (
          <div className="mt-2 flex justify-end">
            <Sparkline
              data={trend}
              color={tone === 'positive' ? 'var(--positive)' : 'var(--primary)'}
              label={trendLabel ?? label}
            />
          </div>
        )}

        {sub && !loading && (
          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-border pt-2.5">
            <span className="text-[11px] leading-snug text-muted">{sub.label}</span>
            <span className={cn('num shrink-0 text-[13px] font-bold', subColor)}>{sub.value}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
