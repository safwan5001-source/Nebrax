'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/** تذييل المستند — يُدفع لأسفل الصفحة (mt-auto داخل غلاف flex-col). */
export function DocFooter({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('footer');
  const { mode } = useDocumentLabelMode(model);
  const isModernV2 = style.composition === 'modern_v2';
  const isLegacyModern = style.composition === 'modern';
  const content =
    properties.static_content ??
    model.footerText ??
    (isModernV2 ? <ModernFieldLabel field="footer" mode={mode} /> : t('footer'));
  const frame = style.composition === 'erp'
    ? 'border-t border-black pt-3'
    : isModernV2 || isLegacyModern
      ? 'border-t border-[color:var(--border)] pt-3'
      : style.composition === 'minimal'
        ? 'border-t border-black pt-3'
        : 'rounded-lg bg-gray-50 p-3';
  const phone = model.seller.phone?.trim();
  const mobile = model.seller.mobile?.trim();

  return (
    <footer className="mt-auto pt-6">
      <div className={cn(frame, 'text-center text-[color:var(--muted)]', isModernV2 ? 'text-[10px] leading-relaxed' : 'text-[10px]', blockTextClassName(properties))}>
        {isModernV2 && (phone || mobile) ? (
          <div className="mb-1 flex flex-wrap justify-center gap-x-4 text-[11px]" dir="ltr">
            {phone ? <span className="num">{phone}</span> : null}
            {mobile ? <span className="num">{mobile}</span> : null}
          </div>
        ) : null}
        {content}
      </div>
    </footer>
  );
}
