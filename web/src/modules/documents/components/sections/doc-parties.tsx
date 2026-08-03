'use client';

import { useTranslations } from 'next-intl';
import type { DocumentModel } from '../../types';
import { DocInfoRow } from './doc-info-row';

/** بطاقات البائع / المشتري / بيانات المستند. */
export function DocParties({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const { seller, buyer, meta } = model;

  return (
    <div className="mt-5 grid grid-cols-3 gap-4">
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('seller')}</div>
        <div className="font-semibold text-black">{seller.name || '—'}</div>
        <DocInfoRow label={t('vat_number')} value={seller.vatNumber ? <span className="num">{seller.vatNumber}</span> : null} />
        <DocInfoRow label={t('cr_number')} value={seller.crNumber ? <span className="num">{seller.crNumber}</span> : null} />
      </div>
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('bill_to')}</div>
        <div className="font-semibold text-black">{buyer.name || '—'}</div>
        <DocInfoRow label={t('vat_number')} value={buyer.vatNumber ? <span className="num">{buyer.vatNumber}</span> : null} />
        <DocInfoRow label={t('city')} value={buyer.city} />
      </div>
      <div className="rounded-lg border border-gray-200 p-3">
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('meta')}</div>
        <DocInfoRow label={t('date')} value={<span className="num">{meta.date}</span>} />
        <DocInfoRow
          label={t('payment_type')}
          value={meta.paymentType ? (meta.paymentType === 'cash' ? t('cash') : t('credit')) : null}
        />
      </div>
    </div>
  );
}
