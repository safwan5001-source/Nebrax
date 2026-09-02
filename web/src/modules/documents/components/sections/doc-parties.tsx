'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { DocInfoRow } from './doc-info-row';
import { useDocStyle } from '../doc-style-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { modernFieldLabel } from '../../presentation/visual-v2';

/** عناوين بطاقات المستند عربية أيضاً؛ تباعد المحارف يكسر وصلها عند رسم PDF. */
export const DOCUMENT_PARTY_CARD_LABEL_CLASS = 'mb-1.5 text-[10px] font-bold text-muted';

/** بيانات البائع/المشتري/المستند بقوالب تركيبية لا تمسّ العقد أو ترتيب الكتلة. */
export function DocParties({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const tPrint = useTranslations('documentPrint');
  const tp = useTranslations('purchasePdf');
  const tDocument = useTranslations('documentPresentation');
  const style = useDocStyle();
  const { seller, buyer, meta } = model;
  const { mode } = useDocumentLabelMode(model);
  const isTaxInvoice = model.type === 'tax_invoice' || model.type === 'simplified_tax_invoice';
  const isPurchaseInvoice = model.type === 'purchase_invoice';
  const isPurchaseDocument = model.type === 'purchase_order' || isPurchaseInvoice;
  const isDeliveryNote = model.type === 'delivery_note';
  const issuerLabel = isPurchaseDocument ? tp('buyer') : tPrint('seller');
  const partyLabel = isDeliveryNote
    ? tDocument('recipient')
    : model.type === 'payment_voucher' || model.type === 'debit_note' || isPurchaseDocument
      ? tPrint('supplier')
      : model.type === 'receipt_voucher' || model.type === 'quotation' || model.type === 'sales_order' || model.type === 'credit_note'
        ? tPrint('customer')
        : t('bill_to');

  const sellerCore = (
    <>
      <div className="break-words font-semibold leading-snug text-black">{seller.name || '—'}</div>
      <DocInfoRow label={style.composition === 'modern' ? modernFieldLabel('vat_number', mode) : t('vat_number')} value={seller.vatNumber ? <span className="num">{seller.vatNumber}</span> : null} />
      {style.composition === 'modern' ? null : (
        <>
          <DocInfoRow label={t('cr_number')} value={seller.crNumber ? <span className="num">{seller.crNumber}</span> : null} />
          <DocInfoRow label={t('national_address')} value={seller.address} />
        </>
      )}
    </>
  );

  const sellerContacts = (
    <>
      <DocInfoRow label={t('phone')} value={seller.phone ? <span className="num" dir="ltr">{seller.phone}</span> : null} />
      <DocInfoRow label={t('mobile')} value={seller.mobile ? <span className="num" dir="ltr">{seller.mobile}</span> : null} />
    </>
  );

  const sellerDetails = (
    <>
      {sellerCore}
      {sellerContacts}
    </>
  );

  const buyerDetails = (
    <>
      <div className="break-words font-semibold leading-snug text-black">{buyer.name || '—'}</div>
      <DocInfoRow label={style.composition === 'modern' ? modernFieldLabel('vat_number', mode) : t('vat_number')} value={buyer.vatNumber ? <span className="num">{buyer.vatNumber}</span> : null} />
      <DocInfoRow label={t('city')} value={buyer.city} />
    </>
  );

  const dueDateLabel = model.type === 'quotation'
    ? tDocument('valid_until')
    : model.type === 'sales_order' || model.type === 'purchase_order'
      ? tDocument('expected_delivery_date')
      : tDocument('payment_due_date');
  const showsPaymentType = isTaxInvoice || isPurchaseInvoice;
  const stackMetaRows = style.composition === 'modern';

  const metaDetails = (
    <>
      <DocInfoRow label={isDeliveryNote ? tDocument('delivery_date') : t('date')} value={<span className="num">{meta.date}</span>} stacked={stackMetaRows} />
      {showsPaymentType && (
        <DocInfoRow
          label={t('payment_type')}
          value={meta.paymentType ? (meta.paymentType === 'cash' ? t('cash') : t('credit')) : null}
          stacked={stackMetaRows}
        />
      )}
      {!isDeliveryNote && !showsPaymentType && meta.dueDate && (
        <DocInfoRow label={dueDateLabel} value={<span className="num">{meta.dueDate}</span>} stacked={stackMetaRows} />
      )}
      {isPurchaseInvoice && meta.dueDate && (
        <DocInfoRow label={tDocument('payment_due_date')} value={<span className="num">{meta.dueDate}</span>} stacked={stackMetaRows} />
      )}
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
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isTaxInvoice ? t('meta') : tDocument('meta')}</div>
          {metaDetails}
        </div>
      </section>
    );
  }

  if (style.composition === 'modern') {
    const modernIssuer = isTaxInvoice ? modernFieldLabel('seller', mode) : issuerLabel;
    const modernParty = isTaxInvoice ? modernFieldLabel('buyer', mode) : partyLabel;
    return (
      <section className={cn('grid grid-cols-2 gap-x-12 gap-y-3 border-b border-[color:var(--border)] pb-4', style.sectionGap)}>
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold text-black">{modernIssuer}</div>
          {sellerCore}
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold text-black">{modernParty}</div>
          {buyerDetails}
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
          <div className={cn(DOCUMENT_PARTY_CARD_LABEL_CLASS, 'mb-0 shrink-0')}>{isTaxInvoice ? t('meta') : tDocument('meta')}</div>
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
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isTaxInvoice ? t('meta') : tDocument('meta')}</div>
        {metaDetails}
      </div>
    </div>
  );
}
