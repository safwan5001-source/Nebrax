'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

type ExtendedSeller = DocumentModel['seller'] & {
  email?: string | null;
  website?: string | null;
  supportNumber?: string | number | null;
};

function clean(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

/**
 * تذييل المستند = هوية التواصل فقط.
 * الهوية القانونية تبقى في الترويسة؛ لا نكرر الرقم الضريبي أو السجل هنا.
 */
export function DocFooter({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('footer');
  const seller = model.seller as ExtendedSeller;
  const content = properties.static_content ?? model.footerText ?? t('footer');
  const contacts = [
    clean(seller.phone),
    clean(seller.mobile),
    clean(seller.email),
    clean(seller.website),
    clean(seller.supportNumber),
  ].filter((value): value is string => Boolean(value));

  const frame = style.composition === 'erp'
    ? 'border-t border-black pt-3'
    : style.composition === 'modern'
      ? 'border-t border-[color:var(--border)] pt-3'
      : style.composition === 'minimal'
        ? 'border-t border-black pt-3'
        : 'rounded-lg bg-gray-50 p-3';

  return (
    <footer className="mt-auto pt-6">
      <div className={cn(frame, 'space-y-1.5 text-[10px] text-center text-[color:var(--muted)]', blockTextClassName(properties))}>
        {content && <div>{content}</div>}
        {contacts.length > 0 && (
          <div className="num flex flex-wrap items-center justify-center gap-x-2 gap-y-1" dir="ltr">
            {contacts.map((value, index) => (
              <span key={`${value}-${index}`} className="inline-flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">•</span>}
                <span>{value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </footer>
  );
}
