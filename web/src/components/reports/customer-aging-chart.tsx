'use client';

/**
 * أسلوب «دفتر التحليل»: رسم واحد يجيب عن سؤال التحصيل قبل جدول التفاصيل.
 * قيمه إجماليات جاهزة من محرك التقارير؛ التحويل العددي هنا لنِسَب SVG البصرية
 * فقط، ولا ينشئ أي حساب محاسبي أو قيمة مالية جديدة.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Donut, type DonutSegment } from '@/components/charts/donut';
import { formatRiyal } from '@/lib/money';

export function CustomerAgingChart({
  totals,
  labels,
}: {
  totals: { b0_30: string; b31_60: string; b61_90: string; b90_plus: string; total: string };
  labels: { title: string; b0_30: string; b31_60: string; b61_90: string; b90_plus: string; total: string };
}) {
  const visualValue = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const segments: DonutSegment[] = [
    { label: labels.b0_30, value: visualValue(totals.b0_30), color: 'var(--primary)' },
    { label: labels.b31_60, value: visualValue(totals.b31_60), color: 'var(--warning)' },
    { label: labels.b61_90, value: visualValue(totals.b61_90), color: 'var(--negative)' },
    { label: labels.b90_plus, value: visualValue(totals.b90_plus), color: 'color-mix(in srgb, var(--negative) 75%, var(--text))' },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{labels.title}</CardTitle>
        <p className="mt-1 text-xs leading-5 text-muted">{labels.total}: <span className="num font-semibold text-text">{formatRiyal(totals.total)}</span></p>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="[&>div]:flex-col [&>div]:items-start sm:[&>div]:flex-row sm:[&>div]:items-center">
          <Donut segments={segments} size={164} formatValue={(value) => formatRiyal(String(value))} />
        </div>
      </CardContent>
    </Card>
  );
}
