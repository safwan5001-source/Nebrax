'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** ترويسة المستند: الهوية والعنوان ورقم المستند، باختلاف تركيبي محسوب لكل قالب. */
export function DocHeader({ model, showLogo = true }: { model: DocumentModel; showLogo?: boolean }) {
  const t = useTranslations('invoiceDoc');
  const tPrint = useTranslations('documentPrint');
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const style = useDocStyle();
  const { seller, meta } = model;
  const numberLabel = model.type === 'tax_invoice' ? t('number') : tPrint('document_number');
  const isRedesignedComposition = style.composition === 'erp' || style.composition === 'modern' || style.composition === 'minimal';

  const identity = (
    <div className="flex min-w-0 items-center gap-3">
      {showLogo &&
        (seller.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL؛ لا يناسبه next/image
          <img
            src={seller.logoUrl}
            alt={seller.name}
            className={cn('w-auto object-contain', isRedesignedComposition && 'max-w-[92px] shrink-0')}
            style={{ height: `${seller.logoHeight ?? 56}px` }}
          />
        ) : (
          <div
            className={cn('flex h-14 w-14 items-center justify-center text-xl font-bold', isRedesignedComposition ? 'shrink-0 rounded-md' : 'rounded-xl')}
            style={{ background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' }}
          >
            {seller.logoText ?? 'نـ'}
          </div>
        ))}
      <div className="min-w-0">
        <div className="break-words text-lg font-bold leading-snug text-black">{seller.name || '—'}</div>
        {seller.tagline && <div className="mt-0.5 break-words text-[11px] text-[color:var(--muted)]">{seller.tagline}</div>}
      </div>
    </div>
  );

  const number = (
    <div className="num text-[11px] font-bold text-black">
      <span className="font-sans font-medium text-[color:var(--muted)]">{numberLabel}: </span>
      {meta.number}
    </div>
  );

  if (style.composition === 'erp') {
    return (
      <header className="border-b-2 border-black pb-3">
        <div className="flex items-start justify-between gap-6">
          {identity}
          <div className="min-w-[172px] shrink-0 text-end">
            <div className="text-[10px] font-semibold text-[color:var(--muted)]">{dtAlt(model.type)}</div>
            <h1 className="mt-0.5 text-[23px] font-bold leading-tight" style={{ color: 'var(--doc-brand)' }}>{dt(model.type)}</h1>
            <div className="mt-2 border-s-2 border-black ps-2">{number}</div>
          </div>
        </div>
        <div className="mt-3 h-1" style={{ background: 'var(--doc-brand)' }} />
      </header>
    );
  }

  if (style.composition === 'modern') {
    return (
      <header className="border-b border-[color:var(--border)] pb-5">
        <div className="flex items-start justify-between gap-8">
          {identity}
          <div className="min-w-[188px] shrink-0 border-s-2 ps-4 text-end" style={{ borderColor: 'var(--doc-brand)' }}>
            <div className="text-[10px] font-semibold" style={{ color: 'var(--doc-brand)' }}>{dtAlt(model.type)}</div>
            <h1 className="mt-1 text-[25px] font-bold leading-tight text-black">{dt(model.type)}</h1>
            <div className="mt-3">{number}</div>
          </div>
        </div>
      </header>
    );
  }

  if (style.composition === 'minimal') {
    return (
      <header className="flex items-end justify-between gap-6 border-b border-black pb-4">
        <div className="min-w-0">
          {identity}
        </div>
        <div className="min-w-[150px] shrink-0 text-end">
          <h1 className="text-[20px] font-semibold leading-tight text-black">{dt(model.type)}</h1>
          <div className="mt-1 text-[10px] text-[color:var(--muted)]">{dtAlt(model.type)}</div>
          <div className="mt-3">{number}</div>
        </div>
      </header>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between">
        {identity}
        <div className="text-end">
          <div className="text-xl font-bold" style={{ color: 'var(--doc-brand)' }}>
            {dt(model.type)}
          </div>
          <div className="text-[11px] text-gray-500">{dtAlt(model.type)}</div>
          <div className="mt-2 inline-block rounded-md bg-gray-100 px-3 py-1">
            <span className="text-gray-500">{numberLabel}: </span>
            <span className="num font-bold text-black">{meta.number}</span>
          </div>
        </div>
      </div>

      {style.brandBar && <div className="mt-4 h-1 rounded" style={{ background: 'var(--doc-brand)' }} />}
    </>
  );
}
