'use client';

import type { DocumentTheme, Direction, TemplateStyle } from '../../types';
import { cn } from '@/lib/utils';
import { themeCssVars } from '../../themes';
import { resolveDirection } from '../../utils/direction';
import { CLASSIC_STYLE } from '../../templates/template-styles';
import { DocStyleProvider } from '../doc-style-context';
import { isNarrowDocPageFrame, useDocPageFrame } from '../doc-page-frame-context';

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
  // Output Profile مدعوم: عرض الجذر وأدنى ارتفاعه من الإطار. غيابه = الصنفان الثابتان
  // `w-[210mm] max-w-[210mm] min-h-[277mm]` كما كانا (DOM مطابق للسابق).
  const frame = useDocPageFrame();
  return (
    <DocStyleProvider value={style}>
      <div
        id={rootId ?? undefined}
        dir={dir}
        style={frame
          ? {
              ...themeCssVars(theme),
              width: `${frame.contentWidthMm}mm`,
              maxWidth: `${frame.contentWidthMm}mm`,
              minHeight: `${frame.contentMinHeightMm}mm`,
            }
          : themeCssVars(theme)}
        data-doc-composition={style.composition}
        data-doc-paper
        data-doc-narrow={isNarrowDocPageFrame(frame) ? '' : undefined}
        className={cn(
          'mx-auto flex flex-col bg-white text-[12px] leading-relaxed text-black shadow-sm print:min-h-0 print:w-full print:shadow-none',
          !frame && 'min-h-[277mm] w-[210mm] max-w-[210mm]',
          style.pagePadding
        )}
      >
        {children}
      </div>
    </DocStyleProvider>
  );
}
