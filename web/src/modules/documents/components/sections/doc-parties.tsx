'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { DocInfoRow } from './doc-info-row';
import { useDocStyle } from '../doc-style-context';

/** عناوين بطاقات المستند عربية أيضاً؛ تباعد المحارف يكسر وصلها عند رسم PDF. */
export const DOCUMENT_PARTY_CARD_LABEL_CLASS = 'mb-1.5 text-[10px] font-bold text-muted';

/** بيانات البائع/المشتري/المستند بقوالب تركيبية لا تمسّ العقد أو ترتيب الكتلة. */
export function DocParties({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const tPrint = useTranslations('documentPrint');
  const tp = useTranslations('purchasePdf');
  const style = useDocStyle();
  const { seller, buyer, meta } = model;
  const isTaxInvoice = model.type === 'tax_invoice';
  const isPurchaseInvoice = model.type === 'purchase_invoice';
  const isInvoice = isTaxInvoice || isPurchaseInvoice;
  const issuerLabel = isPurchaseInvoice ? tp('buyer') : (isTaxInvoice ? t('seller') : tPrint('seller'));
  const partyLabel = model.type === 'payment_voucher' || model.type === 'debit_note' || isPurchaseInvoice
    ? tPrint('supplier')
    : model.type === 'receipt_voucher' || model.type === 'quotation' || model.type === 'credit_note'
      ? tPrint('customer')
      : t('bill_to');

  const sellerDetails = (
    <>
      <div className="break-words font-semibold leading-snug text-black">{seller.name || '—'}</div>
      <DocInfoRow label={t('vat_number')} value={seller.vatNumber ? <span className="num">{seller.vatNumber}</span> : null} />
      <DocInfoRow label={t('cr_number')} value={seller.crNumber ? <span className="num">{seller.crNumber}</span> : null} />
      <DocInfoRow label={t('national_address')} value={seller.address} />
      <DocInfoRow label={t('phone')} value={seller.phone ? <span className="num" dir="ltr">{seller.phone}</span> : null} />
      <DocInfoRow label={t('mobile')} value={seller.mobile ? <span className="num" dir="ltr">{seller.mobile}</span> : null} />
    </>
  );

  const buyerDetails = (
    <>
      <div className="break-words font-semibold leading-snug text-black">{buyer.name || '—'}</div>
      <DocInfoRow label={t('vat_number')} value={buyer.vatNumber ? <span className="num">{buyer.vatNumber}</span> : null} />
      <DocInfoRow label={t('city')} value={buyer.city} />
    </>
  );

  const metaDetails = (
    <>
      <DocInfoRow label={t('date')} value={<span className="num">{meta.date}</span>} />
      {isInvoice && (
        <DocInfoRow
          label={t('payment_type')}
          value={meta.paymentType ? (meta.paymentType === 'cash' ? t('cash') : t('credit')) : null}
        />
      )}
      {!isInvoice && meta.dueDate && <DocInfoRow label={tPrint('due_date')} value={<span className="num">{meta.dueDate}</span>} />}
    </>
  );

  if (style.composition === 'erp') {
    return (
      <section className={cn('grid grid-cols-12 border-y border-black', style.sectionGap)}>
        <div className="col-span-5 border-e border-black py-3 pe-4">
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{issuerLabel}</div>
          {sellerDetails}
        </div>
        <div className="col-span-4 border-e border-black px-4 py-3">
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{partyLabel}</div>
          {buyerDetails}
        </div>
        <div className="col-span-3 py-3 ps-4">
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isInvoice ? t('meta') : tPrint('document_data')}</div>
          {metaDetails}
        </div>
      </section>
    );
  }

  if (style.composition === 'modern') {
    const surface = cn('border border-[color:var(--border)] p-4', style.cardRadius);
    return (
      <section className={cn('grid grid-cols-12 gap-3', style.sectionGap)}>
        <div className={cn('col-span-6', surface)}>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{issuerLabel}</div>
          {sellerDetails}
        </div>
        <div className={cn('col-span-4', surface)}>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{partyLabel}</div>
          {buyerDetails}
        </div>
        <div className={cn('col-span-2 bg-[color:var(--doc-brand-soft)]', surface)}>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isInvoice ? t('meta') : tPrint('document_data')}</div>
          {metaDetails}
        </div>
      </section>
    );
  }

  if (style.composition === 'minimal') {
    return (
      <section className={cn('grid grid-cols-2 gap-x-8 gap-y-4 border-b border-black pb-4', style.sectionGap)}>
        <div>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{issuerLabel}</div>
          {sellerDetails}
        </div>
        <div>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{partyLabel}</div>
          {buyerDetails}
        </div>
        <div className="col-span-2 flex gap-8 border-t border-[color:var(--border)] pt-3">
          <div className={cn(DOCUMENT_PARTY_CARD_LABEL_CLASS, 'mb-0 shrink-0')}>{isInvoice ? t('meta') : tPrint('document_data')}</div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">{metaDetails}</div>
        </div>
      </section>
    );
  }

  const card = cn('border border-gray-200 p-3', style.cardRadius);
  return (
    <div className={cn('grid grid-cols-3 gap-4', style.sectionGap)}>
      <div className={card}>
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{issuerLabel}</div>
        {sellerDetails}
      </div>
      <div className={card}>
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{partyLabel}</div>
        {buyerDetails}
      </div>
      <div className={card}>
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isInvoice ? t('meta') : tPrint('document_data')}</div>
        {metaDetails}
      </div>
    </div>
  );
}
