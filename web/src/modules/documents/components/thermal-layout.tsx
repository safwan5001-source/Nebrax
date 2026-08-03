'use client';

import type { DocumentTheme, Direction } from '../types';
import { themeCssVars } from '../themes';
import { resolveDirection } from '../utils/direction';

/**
 * غلاف إيصال حراري ضيّق (58mm/80mm) — جذر الالتقاط (#print-root) *هو نفسه* الإيصال
 * بعرضه الثابت، فيُلتقَط/يُطبَع بالعرض الحراري الصحيح.
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
    <div
      id={rootId ?? undefined}
      dir={dir}
      style={{ ...themeCssVars(theme), width: `${widthMm}mm` }}
      className="mx-auto bg-white p-3 text-[11px] leading-snug text-black shadow-lg print:shadow-none"
    >
      {children}
    </div>
  );
}
