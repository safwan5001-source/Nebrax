'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { DocInfoRow } from './doc-info-row';
import { useDocStyle } from '../doc-style-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

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
      <DocInfoRow label={style.composition === 'modern_v2' ? <ModernFieldLabel field="vat_number" mode={mode} /> : t('vat_number')} value={seller.vatNumber ? <span className="num" dir="ltr">{seller.vatNumber}</span> : null} />
      {style.composition === 'modern_v2' ? null : (
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
      <DocInfoRow label={style.composition === 'modern_v2' ? <ModernFieldLabel field="vat_number" mode={mode} /> : t('vat_number')} value={buyer.vatNumber ? <span className="num" dir="ltr">{buyer.vatNumber}</span> : null} />
      <DocInfoRow label={style.composition === 'modern_v2' ? <ModernFieldLabel field="city" mode={mode} /> : t('city')} value={buyer.city} />
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
      <DocInfoRow label={isDeliveryNote ? tDocument('delivery_date') : t('date')} value={<span className="num" dir="ltr">{meta.date}</span>} stacked={stackMetaRows} />
      {showsPaymentType && (
        <DocInfoRow
          label={t('payment_type')}
          value={meta.paymentType ? (meta.paymentType === 'cash' ? t('cash') : t('credit')) : null}
          stacked={stackMetaRows}
        />
      )}
      {!isDeliveryNote && !showsPaymentType && meta.dueDate && (
        <DocInfoRow label={dueDateLabel} value={<span className="num" dir="ltr">{meta.dueDate}</span>} stacked={stackMetaRows} />
      )}
      {isPurchaseInvoice && meta.dueDate && (
        <DocInfoRow label={tDocument('payment_due_date')} value={<span className="num" dir="ltr">{meta.dueDate}</span>} stacked={stackMetaRows} />
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

  if (style.composition === 'erp_v2') {
    const issuerField = isPurchaseDocument
      ? 'purchase_buyer' as const
      : isTaxInvoice
        ? 'seller' as const
        : 'company' as const;
    const partyField = isDeliveryNote
      ? 'recipient' as const
      : model.type === 'payment_voucher' || model.type === 'debit_note' || isPurchaseDocument
        ? 'supplier' as const
        : model.type === 'receipt_voucher' || model.type === 'quotation' || model.type === 'sales_order' || model.type === 'credit_note'
          ? 'customer' as const
          : 'buyer' as const;
    return (
      <section className={cn('grid grid-cols-2 border-y border-black', style.sectionGap)}>
        <div className="min-w-0 border-e border-black py-2 pe-3">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-black"><ModernFieldLabel field={issuerField} mode={mode} /></div>
          <div className="break-words text-[11px] font-semibold leading-snug text-black">{seller.name || '—'}</div>
          <DocInfoRow label={<ModernFieldLabel field="vat_number" mode={mode} />} value={seller.vatNumber ? <span className="num" dir="ltr">{seller.vatNumber}</span> : null} />
        </div>
        <div className="min-w-0 py-2 ps-3">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wide text-black"><ModernFieldLabel field={partyField} mode={mode} /></div>
          <div className="break-words text-[11px] font-semibold leading-snug text-black">{buyer.name || '—'}</div>
          <DocInfoRow label={<ModernFieldLabel field="vat_number" mode={mode} />} value={buyer.vatNumber ? <span className="num" dir="ltr">{buyer.vatNumber}</span> : null} />
          <DocInfoRow label={<ModernFieldLabel field="city" mode={mode} />} value={buyer.city} />
        </div>
      </section>
    );
  }

  if (style.composition === 'classic_v2') {
    const issuerField = isPurchaseDocument
      ? 'purchase_buyer' as const
      : isTaxInvoice
        ? 'seller' as const
        : 'company' as const;
    const partyField = isDeliveryNote
      ? 'recipient' as const
      : model.type === 'payment_voucher' || model.type === 'debit_note' || isPurchaseDocument
        ? 'supplier' as const
        : model.type === 'receipt_voucher' || model.type === 'quotation' || model.type === 'sales_order' || model.type === 'credit_note'
          ? 'customer' as const
          : 'buyer' as const;
    return (
      <section className={cn('grid grid-cols-2 border border-black', style.sectionGap)}>
        <div className="min-w-0 border-e border-black py-2.5 pe-4">
          <div className="mb-1.5 text-[10px] font-semibold text-black"><ModernFieldLabel field={issuerField} mode={mode} /></div>
          <div className="break-words text-[12px] font-semibold leading-snug text-black">{seller.name || '—'}</div>
          <DocInfoRow label={<ModernFieldLabel field="vat_number" mode={mode} />} value={seller.vatNumber ? <span className="num" dir="ltr">{seller.vatNumber}</span> : null} />
        </div>
        <div className="min-w-0 py-2.5 ps-4">
          <div className="mb-1.5 text-[10px] font-semibold text-black"><ModernFieldLabel field={partyField} mode={mode} /></div>
          <div className="break-words text-[12px] font-semibold leading-snug text-black">{buyer.name || '—'}</div>
          <DocInfoRow label={<ModernFieldLabel field="vat_number" mode={mode} />} value={buyer.vatNumber ? <span className="num" dir="ltr">{buyer.vatNumber}</span> : null} />
          <DocInfoRow label={<ModernFieldLabel field="city" mode={mode} />} value={buyer.city} />
        </div>
      </section>
    );
  }

  if (style.composition === 'modern_v2') {
    const issuerField = isPurchaseDocument
      ? 'purchase_buyer' as const
      : isTaxInvoice
        ? 'seller' as const
        : 'company' as const;
    const partyField = isDeliveryNote
      ? 'recipient' as const
      : model.type === 'payment_voucher' || model.type === 'debit_note' || isPurchaseDocument
        ? 'supplier' as const
        : model.type === 'receipt_voucher' || model.type === 'quotation' || model.type === 'sales_order' || model.type === 'credit_note'
          ? 'customer' as const
          : 'buyer' as const;
    return (
      <section className={cn('grid grid-cols-2 gap-x-12 gap-y-3 border-b border-[color:var(--border)] pb-4', style.sectionGap)}>
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold text-black"><ModernFieldLabel field={issuerField} mode={mode} /></div>
          {sellerCore}
        </div>
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold text-black"><ModernFieldLabel field={partyField} mode={mode} /></div>
          {buyerDetails}
        </div>
      </section>
    );
  }

  if (style.composition === 'modern') {
    const surface = cn('border border-[color:var(--border)] p-4', style.cardRadius);
    return (
      <section className={cn('grid grid-cols-12 gap-3', style.sectionGap)}>
        <div className={cn('col-span-5', surface)}>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{issuerLabel}</div>
          {sellerDetails}
        </div>
        <div className={cn('col-span-4', surface)}>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{partyLabel}</div>
          {buyerDetails}
        </div>
        <div className={cn('col-span-3 bg-[color:var(--doc-brand-soft)]', surface)}>
          <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isTaxInvoice ? t('meta') : tDocument('meta')}</div>
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
