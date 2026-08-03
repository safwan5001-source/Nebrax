'use client';

import type { DocumentTheme, Direction } from '../../types';
import { themeCssVars } from '../../themes';
import { resolveDirection } from '../../utils/direction';

/**
 * غلاف المستند A4 — جذر الالتقاط (#print-root) الذي يُطبَع ويُصدَّر PDF.
 * يُسقط متغيّرات الثيم فتَرِثها الأقسام، ويضبط الاتجاه. مرئيّ على الشاشة كمعاينة.
 */
export function DocLayout({
  theme,
  direction,
  directionSample,
  children,
}: {
  theme: DocumentTheme;
  direction: Direction;
  directionSample?: string | null;
  children: React.ReactNode;
}) {
  const dir = resolveDirection(direction, directionSample);
  return (
    <div id="print-root" dir={dir} style={themeCssVars(theme)}>
      <div className="mx-auto flex min-h-[277mm] w-[210mm] max-w-[210mm] flex-col bg-white p-8 text-[12px] leading-relaxed text-black shadow-lg print:min-h-0 print:w-full print:shadow-none">
        {children}
      </div>
    </div>
  );
}
