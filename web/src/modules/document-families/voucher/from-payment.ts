import { riyalToMinor } from '@/lib/money';
import type { SourceCompany, SourceCustomer } from '@/modules/documents/builder/from-invoice';
import type { SourcePayment } from '@/modules/documents/builder/from-payment';
import type { VoucherDocument } from '../types';

/**
 * يبني عقد السند من مصدره التشغيلي مباشرة. لا توجد هنا بنود فاتورة أو ضريبة أو
 * إجماليات مصطنعة؛ أي تحويل إلى العارض القديم يبقى في محول توافق معزول.
 */
export function buildVoucherDocument(input: {
  payment: SourcePayment;
  company: SourceCompany | null;
  partner: SourceCustomer | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
}): VoucherDocument {
  const { payment, company, partner, footerText, logoUrl, logoHeight, bank, stampUrl, signatureUrl } = input;
  const isReceived = payment.direction === 'received';
  const amount = riyalToMinor(payment.amount);

  return {
    family: 'voucher',
    type: isReceived ? 'receipt_voucher' : 'payment_voucher',
    currency: 'SAR',
    direction: 'rtl',
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : null,
      logoHeight: logoHeight ?? null,
    },
    counterparty: {
      name: partner?.name ?? '—',
      vatNumber: partner?.vat_number ?? null,
      city: partner?.city ?? null,
    },
    meta: {
      number: payment.number,
      date: payment.payment_date,
      dueDate: null,
      paymentType: null,
    },
    content: {
      footerText: footerText && footerText.trim() !== '' ? footerText : null,
      notes: payment.notes ?? null,
      terms: null,
      bank: bank && bank.trim() !== '' ? bank : null,
      stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
      signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
    },
    voucher: {
      direction: isReceived ? 'received' : 'paid',
      method: payment.method,
      amount,
      reference: payment.reference ?? null,
      allocations: (payment.allocations ?? []).map((allocation) => ({
        label: allocation.label,
        amount: riyalToMinor(allocation.amount),
      })),
    },
  };
}
