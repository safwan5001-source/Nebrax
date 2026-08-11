'use client';

/**
 * خط بياني بتعبئة متدرّجة — SVG خالص بلا مكتبة رسم.
 *
 * الزمن يجري **من اليسار إلى اليمين** وأحدث نقطة عند الطرف الأيمن، كما في
 * المرجع البصري: هذا عرف الرسوم البيانية حتى في الواجهات العربية، وقلبُه
 * يجعل الصعود يُقرأ هبوطاً.
 *
 * `preserveAspectRatio="none"` يمدّ الرسم على عرض الحاوية بلا حساب مقاسات
 * في JS — فلا حاجة إلى مراقب حجم ولا إعادة رسم عند تغيّر النافذة.
 */
export function AreaLine({
  data,
  color = 'var(--positive)',
  height = 180,
  label,
  className,
}: {
  data: number[];
  color?: string;
  height?: number;
  /** وصف نصّي لقارئ الشاشة — الرسم وحده لا يُقرأ. */
  label?: string;
  className?: string;
}) {
  const points = data.length >= 2 ? data : [...data, ...data];
  const W = 600;
  const H = 180;
  const pad = 10;

  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;

  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className={className}
      role="img"
      aria-label={label}
    >
      {/* تعبئة مسطّحة خفيفة لا تدرّج — `DESIGN_SYSTEM.md`: «بلا زخرفة: لا تدرّجات». */}
      <path d={area} fill={color} fillOpacity="0.1" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="4" fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * أعمدة أفقية لبُعد **تصنيفي** (منتج/فئة/فرع/بائع).
 *
 * خطٌّ بياني عبر المنتجات بلا معنى: لا ترتيب طبيعي بين صنفٍ وصنف، والخط
 * يوهم باتجاه لا وجود له. الأعمدة تقارن مقادير — وهو السؤال الحقيقي هنا.
 */
export function RankedBars({
  rows,
  format,
  color = 'var(--positive)',
  emptyLabel,
}: {
  rows: { label: string; amount: number }[];
  format: (n: number) => string;
  color?: string;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>;
  }

  const max = Math.max(...rows.map((r) => r.amount), 1);

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-muted">{row.label}</span>
            <span className="num shrink-0 text-text">{format(row.amount)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-border/60">
            <div
              className="h-full rounded"
              style={{ width: `${(row.amount / max) * 100}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
