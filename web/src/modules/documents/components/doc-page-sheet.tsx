'use client';

import type { DocPageFrame } from '../services/output-spec';

/**
 * ورقة المعاينة: مستطيل الورق بأبعاده الفعلية والهوامش حول جذر المستند، مع حدّ منقّط
 * خفيف يبيّن منطقة المحتوى. في الطباعة يُلغى عرضه وحشوه (`print:!w-auto print:!p-0`) لأن الهوامش يفرضها `@page` وإلا
 * تجاوز عرضُ الورق مساحةَ الطباعة فيُصغّر Chromium الصفحة كلها. تُرسم **خارج** جذر الطباعة/PDF (#print-root) فلا تُلتقَط ولا تُطبَع:
 * الإطار المنقّط `no-print`، والغلاف `print:static` كي لا يصير مرجع تموضع لوجهة الطباعة
 * المطلقة (`[data-print-target]`) ولا يحمل ظلاً أو خلفية عند الطباعة.
 */
export function DocPageSheet({
  frame,
  hidden = false,
  children,
}: {
  frame: DocPageFrame;
  /** جذر مخفي على الشاشة (جذر PDF المستقل): يُخفى غلافه كله؛ التقاط PDF يكشف الأجداد المخفية مؤقتاً. */
  hidden?: boolean;
  children: React.ReactNode;
}) {
  const m = frame.marginsMm;

  return (
    <div
      data-doc-sheet
      data-doc-paper
      data-doc-sheet-hidden={hidden ? 'true' : undefined}
      data-doc-sheet-paper={`${frame.paperWidthMm}x${frame.paperHeightMm}`}
      className={`${hidden ? 'hidden ' : ''}relative mx-auto bg-surface shadow-md print:static print:!m-0 print:!w-auto print:!max-w-none print:!p-0 print:bg-transparent print:shadow-none`}
      style={{
        width: `${frame.paperWidthMm}mm`,
        maxWidth: `${frame.paperWidthMm}mm`,
        padding: `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`,
        boxSizing: 'border-box',
      }}
    >
      <div
        aria-hidden="true"
        data-doc-sheet-guide
        className="no-print pointer-events-none absolute border border-dashed border-border"
        style={{ inset: `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm` }}
      />
      {children}
    </div>
  );
}
