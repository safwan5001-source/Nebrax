'use client';

import type { DocumentTheme, Direction, TemplateStyle } from '../../types';
import { cn } from '@/lib/utils';
import { themeCssVars } from '../../themes';
import { resolveDirection } from '../../utils/direction';
import { CLASSIC_STYLE } from '../../templates/template-styles';
import { DocStyleProvider } from '../doc-style-context';

/**
 * غلاف المستند A4 — جذر الالتقاط (#print-root) الذي يُطبَع ويُصدَّر PDF *هو نفسه*
 * ورقة الـ 210mm (لا غلاف خارجي بعرض الحاوية)، فيُلتقَط بالعرض الصحيح دون قصّ
 * أو صفحات زائدة أياً كان عرض الشاشة. يُسقط متغيّرات الثيم ويوفّر أسلوب القالب.
 */
export function DocLayout({
  theme,
  direction,
  directionSample,
  style = CLASSIC_STYLE,
  rootId = 'print-root',
  children,
}: {
  theme: DocumentTheme;
  direction: Direction;
  directionSample?: string | null;
  style?: TemplateStyle;
  rootId?: string | null;
  children: React.ReactNode;
}) {
  const dir = resolveDirection(direction, directionSample);
  return (
    <DocStyleProvider value={style}>
      <div
        id={rootId ?? undefined}
        dir={dir}
        style={themeCssVars(theme)}
        data-doc-composition={style.composition}
        className={cn(
          'mx-auto flex min-h-[277mm] w-[210mm] max-w-[210mm] flex-col bg-white text-[12px] leading-relaxed text-black shadow-sm print:min-h-0 print:w-full print:shadow-none',
          style.pagePadding
        )}
      >
        {children}
      </div>
    </DocStyleProvider>
  );
}
