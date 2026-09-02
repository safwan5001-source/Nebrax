'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { DocInfoRow } from './doc-info-row';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import {
  VISUAL_V2,
  cappedLogoHeight,
  isNoticeStatus,
  localizedPair,
  modernFieldLabel,
  modernStatusLabel,
} from '../../presentation/visual-v2';

/** ترويسة المستند: الهوية والعنوان ورقم المستند، باختلاف تركيبي محسوب لكل قالب. */
export function DocHeader({ model, showLogo = true }: { model: DocumentModel; showLogo?: boolean }) {
  const t = useTranslations('invoiceDoc');
  const tPrint = useTranslations('documentPrint');
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const tDocument = useTranslations('documentPresentation');
  const style = useDocStyle();
  const { seller, meta } = model;
  const numberLabel = model.type === 'tax_invoice' ? t('number') : tPrint('document_number');
  const isRedesignedComposition = style.composition === 'erp' || style.composition === 'modern' || style.composition === 'minimal';
  const { locale, mode } = useDocumentLabelMode(model);
  const isTaxInvoice = model.type === 'tax_invoice' || model.type === 'simplified_tax_invoice';
  const isPurchaseInvoice = model.type === 'purchase_invoice';
  const showsPaymentType = isTaxInvoice || isPurchaseInvoice;
  const dueDateLabel = model.type === 'quotation'
    ? tDocument('valid_until')
    : model.type === 'sales_order' || model.type === 'purchase_order'
      ? tDocument('expected_delivery_date')
      : modernFieldLabel('due_date', mode);

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
    const logoHeight = cappedLogoHeight(seller.logoHeight);
    const title = localizedPair(locale, dt(model.type), dtAlt(model.type), mode);
    const invoiceNumberLabel = isTaxInvoice ? modernFieldLabel('number', mode) : tPrint('document_number');
    return (
      <header className="border-b border-[color:var(--border)] pb-4">
        <div className="flex items-start justify-between gap-8">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {showLogo && seller.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL؛ لا يناسبه next/image
              <img
                src={seller.logoUrl}
                alt={seller.name}
                className={VISUAL_V2.logoMaxWidthClass}
                style={{ height: `${logoHeight}px` }}
              />
            ) : null}
            <div className="min-w-0">
              <div className="line-clamp-2 break-words text-[15px] font-bold leading-snug text-black">{seller.name || '—'}</div>
              {seller.tagline ? <div className="mt-0.5 line-clamp-1 break-words text-[10px] text-[color:var(--muted)]">{seller.tagline}</div> : null}
              <div className="mt-1.5 space-y-0.5">
                <DocInfoRow label={modernFieldLabel('vat_number', mode)} value={seller.vatNumber ? <span className="num">{seller.vatNumber}</span> : null} stacked />
                <DocInfoRow label={modernFieldLabel('cr_number', mode)} value={seller.crNumber ? <span className="num">{seller.crNumber}</span> : null} stacked />
                <DocInfoRow label={t('national_address')} value={seller.address ? <span className="line-clamp-2">{seller.address}</span> : null} stacked />
              </div>
            </div>
          </div>
          <div className="min-w-[176px] max-w-[46%] shrink-0 text-end">
            <h1 className="text-[20px] font-bold leading-tight text-black">{title}</h1>
            <div className="mt-1.5 h-px w-full" style={{ background: 'var(--doc-brand)' }} />
            <div className="mt-2 space-y-0.5">
              <DocInfoRow
                label={invoiceNumberLabel}
                value={<span className="num font-bold">{meta.number}</span>}
                stacked
                align="end"
              />
              <DocInfoRow label={modernFieldLabel('date', mode)} value={<span className="num">{meta.date}</span>} stacked align="end" />
              {meta.dueDate ? <DocInfoRow label={dueDateLabel} value={<span className="num">{meta.dueDate}</span>} stacked align="end" /> : null}
              {showsPaymentType ? (
                <DocInfoRow
                  label={modernFieldLabel('payment_type', mode)}
                  value={meta.paymentType ? (meta.paymentType === 'cash' ? t('cash') : t('credit')) : null}
                  stacked
                  align="end"
                />
              ) : null}
            </div>
            {isNoticeStatus(model.status) ? (
              <div
                data-doc-status-notice={model.status}
                className={cn(
                  'mt-2 inline-block border px-2 py-0.5 text-[10px] font-semibold',
                  model.status === 'cancelled'
                    ? 'border-[color:var(--negative)] text-[color:var(--negative)]'
                    : 'border-[color:var(--border)] text-[color:var(--muted)]',
                )}
              >
                {modernStatusLabel(model.status, mode)}
              </div>
            ) : null}
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
