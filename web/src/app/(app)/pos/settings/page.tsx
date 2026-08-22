'use client';

import { useTranslations } from 'next-intl';
import { ConfigForm } from '@/components/sales-config/config-form';

export default function PosSettingsPage() {
  const t = useTranslations('posSettings');
  return (
    <ConfigForm
      section="pos"
      backHref="/pos"
      title={t('title')}
      description={t('subtitle')}
      fields={[
        { key: 'default_customer', label: t('default_customer'), type: 'text' },
        { key: 'receipt_footer', label: t('receipt_footer'), type: 'text' },
        { key: 'print_receipt', label: t('print_receipt'), type: 'checkbox' },
        { key: 'allow_discount', label: t('allow_discount'), type: 'checkbox' },
        {
          key: 'cash_refund_policy',
          label: t('cash_refund_policy'),
          description: t('cash_refund_policy_hint'),
          type: 'select',
          options: [
            { value: 'original_cash_only', label: t('cash_refund_original_cash_only') },
            { value: 'allow_any_pos_sale', label: t('cash_refund_allow_any_pos_sale') },
          ],
        },
        {
          key: 'exchange_surplus_policy',
          label: t('exchange_surplus_policy'),
          description: t('exchange_surplus_policy_hint'),
          type: 'select',
          options: [
            { value: 'customer_credit_only', label: t('exchange_surplus_customer_credit_only') },
            { value: 'allow_cash_refund', label: t('exchange_surplus_allow_cash_refund') },
          ],
        },
        {
          key: 'held_sale_close_policy',
          label: t('held_sale_close_policy'),
          description: t('held_sale_close_policy_hint'),
          type: 'select',
          options: [
            { value: 'discard_on_session_close', label: t('held_sale_discard_on_session_close') },
            { value: 'keep_for_next_session', label: t('held_sale_keep_for_next_session') },
          ],
        },
      ]}
    />
  );
}
