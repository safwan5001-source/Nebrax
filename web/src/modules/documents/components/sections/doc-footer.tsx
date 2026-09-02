'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

/** تذييل المستند — يُدفع لأسفل الصفحة (mt-auto داخل غلاف flex-col). */
export function DocFooter({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('footer');
  const content = properties.static_content ?? model.footerText ?? t('footer');
  const isModern = style.composition === 'modern';
  const frame = style.composition === 'erp'
    ? 'border-t border-black pt-3'
    : isModern
      ? 'border-t border-[color:var(--border)] pt-3'
      : style.composition === 'minimal'
        ? 'border-t border-black pt-3'
        : 'rounded-lg bg-gray-50 p-3';
  const phone = model.seller.phone?.trim();
  const mobile = model.seller.mobile?.trim();

  return (
    <footer className="mt-auto pt-6">
      <div className={cn(frame, 'text-center text-[color:var(--muted)]', isModern ? 'text-[10px] leading-relaxed' : 'text-[10px]', blockTextClassName(properties))}>
        {isModern && (phone || mobile) ? (
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
