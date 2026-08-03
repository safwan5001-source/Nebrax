'use client';

import { useTranslations } from 'next-intl';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** ترويسة المستند: الشعار + اسم البائع + عنوان المستند ورقمه + شريط الهوية. */
export function DocHeader({ model, showLogo = true }: { model: DocumentModel; showLogo?: boolean }) {
  const t = useTranslations('invoiceDoc');
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const style = useDocStyle();
  const { seller, meta } = model;

  return (
    <>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {showLogo && (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-xl text-xl font-bold"
              style={{ background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' }}
            >
              {seller.logoText ?? 'نـ'}
            </div>
          )}
          <div>
            <div className="text-lg font-bold text-black">{seller.name || '—'}</div>
            <div className="text-[11px] text-gray-500">{seller.tagline ?? t('brand_tagline')}</div>
          </div>
        </div>
        <div className="text-end">
          <div className="text-xl font-bold" style={{ color: 'var(--doc-brand)' }}>
            {dt(model.type)}
          </div>
          <div className="text-[11px] text-gray-500">{dtAlt(model.type)}</div>
          <div className="mt-2 inline-block rounded-md bg-gray-100 px-3 py-1">
            <span className="text-gray-500">{t('number')}: </span>
            <span className="num font-bold text-black">{meta.number}</span>
          </div>
        </div>
      </div>

      {style.brandBar && <div className="mt-4 h-1 rounded" style={{ background: 'var(--doc-brand)' }} />}
    </>
  );
}
