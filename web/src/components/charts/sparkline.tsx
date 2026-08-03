'use client';

import { cn } from '@/lib/utils';

/**
 * خط اتجاه مصغّر (Sparkline) — SVG `polyline` خالص، بلا مكتبات وبلا زخرفة.
 * (المرجع: design-system/financial/charts.md — نوع مقترح داخل بطاقة KPI.)
 *
 * قواعد ملتزَمة:
 *  - لون دلالي واحد يُمرَّر عبر `color` (توكن CSS مثل `var(--positive)`).
 *  - يرافق دائماً قيمة رقمية صريحة في البطاقة (لا رسم بلا رقم).
 *  - بلا تدرّجات ولا ظلال ولا حركة؛ خطّ نظيف + نقطة نهاية دقيقة فقط.
 */
export function Sparkline({
  data,
  color = 'var(--primary)',
  width = 72,
  height = 24,
  label,
  className,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1; // سلسلة مستوية → خطّ في المنتصف (يتجنّب القسمة على صفر)
  const pad = 2; // هامش رأسي حتى لا تُقصّ حدود الخطّ
  const stepX = (width - pad * 2) / (data.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const points = data.map((v, i) => `${(pad + i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastX = pad + (data.length - 1) * stepX;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('shrink-0 overflow-visible', className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={y(data[data.length - 1])} r={1.8} fill={color} />
    </svg>
  );
}
