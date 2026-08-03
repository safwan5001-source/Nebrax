'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { DocInfoRow } from './doc-info-row';
import { useDocStyle } from '../doc-style-context';

/** بطاقات البائع / المشتري / بيانات المستند. */
export function DocParties({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const { seller, buyer, meta } = model;
  const card = cn('border border-gray-200 p-3', style.cardRadius);

  return (
    <div className={cn('grid grid-cols-3 gap-4', style.sectionGap)}>
      <div className={card}>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('seller')}</div>
        <div className="font-semibold text-black">{seller.name || '—'}</div>
        <DocInfoRow label={t('vat_number')} value={seller.vatNumber ? <span className="num">{seller.vatNumber}</span> : null} />
        <DocInfoRow label={t('cr_number')} value={seller.crNumber ? <span className="num">{seller.crNumber}</span> : null} />
      </div>
      <div className={card}>
        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('bill_to')}</div>
        <div className="font-semibold text-black">{buyer.name || '—'}</div>
        <DocInfoRow label={t('vat_number')} value={buyer.vatNumber ? <span className="num">{buyer.vatNumber}</span> : null} />
        <DocInfoRow label={t('city')} value={buyer.city} />
      </div>
      <div className={card}>
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
