'use client';

import { useTranslations } from 'next-intl';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** ترويسة المستند: الشعار + اسم البائع + عنوان المستند ورقمه + شريط الهوية. */
export function DocHeader({ model, showLogo = true }: { model: DocumentModel; showLogo?: boolean }) {
  const t = useTranslations('invoiceDoc');
  const tPrint = useTranslations('documentPrint');
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const style = useDocStyle();
  const { seller, meta } = model;

  return (
    <>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {showLogo &&
            (seller.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL؛ لا يناسبه next/image
              <img
                src={seller.logoUrl}
                alt={seller.name}
                className="w-auto object-contain"
                style={{ height: `${seller.logoHeight ?? 56}px` }}
              />
            ) : (
              <div
                className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold"
                style={{ background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' }}
              >
                {seller.logoText ?? 'نـ'}
              </div>
            ))}
          <div>
            <div className="text-lg font-bold text-black">{seller.name || '—'}</div>
            {seller.tagline && <div className="text-[11px] text-gray-500">{seller.tagline}</div>}
          </div>
        </div>
        <div className="text-end">
          <div className="text-xl font-bold" style={{ color: 'var(--doc-brand)' }}>
            {dt(model.type)}
          </div>
          <div className="text-[11px] text-gray-500">{dtAlt(model.type)}</div>
          <div className="mt-2 inline-block rounded-md bg-gray-100 px-3 py-1">
            <span className="text-gray-500">{model.type === 'tax_invoice' ? t('number') : tPrint('document_number')}: </span>
            <span className="num font-bold text-black">{meta.number}</span>
          </div>
        </div>
      </div>

      {style.brandBar && <div className="mt-4 h-1 rounded" style={{ background: 'var(--doc-brand)' }} />}
    </>
  );
}
