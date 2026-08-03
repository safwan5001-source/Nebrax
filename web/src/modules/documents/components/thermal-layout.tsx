'use client';

import type { DocumentTheme, Direction } from '../types';
import { themeCssVars } from '../themes';
import { resolveDirection } from '../utils/direction';

/**
 * غلاف إيصال حراري ضيّق (58mm/80mm) — عمود واحد مضغوط، لا A4. جذر الالتقاط
 * (#print-root افتراضياً) للطباعة/PDF بالعرض الحراري.
 */
export function ThermalLayout({
  theme,
  direction,
  directionSample,
  widthMm,
  rootId = 'print-root',
  children,
}: {
  theme: DocumentTheme;
  direction: Direction;
  directionSample?: string | null;
  widthMm: number;
  rootId?: string | null;
  children: React.ReactNode;
}) {
  const dir = resolveDirection(direction, directionSample);
  return (
    <div id={rootId ?? undefined} dir={dir} style={themeCssVars(theme)}>
      <div
        className="mx-auto bg-white p-3 text-[11px] leading-snug text-black shadow-lg print:shadow-none"
        style={{ width: `${widthMm}mm` }}
      >
        {children}
      </div>
    </div>
  );
}
