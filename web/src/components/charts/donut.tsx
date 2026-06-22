'use client';

export interface DonutSegment {
  label: string;
  value: number;
  color: string; // CSS color (e.g. var(--positive))
}

// رسم دائري مجوّف بـ SVG خالص — بلا مكتبات.
export function Donut({ segments, size = 120 }: { segments: DonutSegment[]; size?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 45;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border)" strokeWidth="14" />
        {total > 0 &&
          segments.map((seg, i) => {
            const len = (seg.value / total) * c;
            const el = (
              <circle
                key={i}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth="14"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      <ul className="space-y-1 text-xs">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: seg.color }} />
            <span className="text-muted">{seg.label}</span>
            <span className="num ms-auto text-text">{seg.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
