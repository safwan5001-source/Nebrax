'use client';

import type { DocumentTheme, Direction, TemplateStyle } from '../../types';
import { cn } from '@/lib/utils';
import { themeCssVars } from '../../themes';
import { resolveDirection } from '../../utils/direction';
import { CLASSIC_STYLE } from '../../templates/template-styles';
import { DocStyleProvider } from '../doc-style-context';

/**
 * غلاف المستند A4 — جذر الالتقاط (#print-root) الذي يُطبَع ويُصدَّر PDF.
 * يُسقط متغيّرات الثيم ويوفّر أسلوب القالب للأقسام، ويضبط الاتجاه.
 */
export function DocLayout({
  theme,
  direction,
  directionSample,
  style = CLASSIC_STYLE,
  children,
}: {
  theme: DocumentTheme;
  direction: Direction;
  directionSample?: string | null;
  style?: TemplateStyle;
  children: React.ReactNode;
}) {
  const dir = resolveDirection(direction, directionSample);
  return (
    <div id="print-root" dir={dir} style={themeCssVars(theme)}>
      <DocStyleProvider value={style}>
        <div
          className={cn(
            'mx-auto flex min-h-[277mm] w-[210mm] max-w-[210mm] flex-col bg-white text-[12px] leading-relaxed text-black shadow-lg print:min-h-0 print:w-full print:shadow-none',
            style.pagePadding
          )}
        >
          {children}
        </div>
      </DocStyleProvider>
    </div>
  );
}
