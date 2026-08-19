'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { DocInfoRow } from './doc-info-row';
import { useDocStyle } from '../doc-style-context';

/** عناوين بطاقات المستند عربية أيضاً؛ تباعد المحارف يكسر وصلها عند رسم PDF. */
export const DOCUMENT_PARTY_CARD_LABEL_CLASS = 'mb-1.5 text-[10px] font-bold text-gray-400';

/** بطاقات البائع / المشتري / بيانات المستند. */
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
  const card = cn('border border-gray-200 p-3', style.cardRadius);

  return (
    <div className={cn('grid grid-cols-3 gap-4', style.sectionGap)}>
      <div className={card}>
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{issuerLabel}</div>
        <div className="font-semibold text-black">{seller.name || '—'}</div>
        <DocInfoRow label={t('vat_number')} value={seller.vatNumber ? <span className="num">{seller.vatNumber}</span> : null} />
        <DocInfoRow label={t('cr_number')} value={seller.crNumber ? <span className="num">{seller.crNumber}</span> : null} />
      </div>
      <div className={card}>
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{partyLabel}</div>
        <div className="font-semibold text-black">{buyer.name || '—'}</div>
        <DocInfoRow label={t('vat_number')} value={buyer.vatNumber ? <span className="num">{buyer.vatNumber}</span> : null} />
        <DocInfoRow label={t('city')} value={buyer.city} />
      </div>
      <div className={card}>
        <div className={DOCUMENT_PARTY_CARD_LABEL_CLASS}>{isInvoice ? t('meta') : tPrint('document_data')}</div>
        <DocInfoRow label={t('date')} value={<span className="num">{meta.date}</span>} />
        {isInvoice && (
          <DocInfoRow
            label={t('payment_type')}
            value={meta.paymentType ? (meta.paymentType === 'cash' ? t('cash') : t('credit')) : null}
          />
        )}
        {!isInvoice && meta.dueDate && <DocInfoRow label={tPrint('due_date')} value={<span className="num">{meta.dueDate}</span>} />}
      </div>
    </div>
  );
}
