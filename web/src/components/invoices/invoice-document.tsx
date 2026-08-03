'use client';

import { getTemplate } from '@/modules/documents/registry/templates';
import { getTheme } from '@/modules/documents/themes';
import { makeMoneyFormatter } from '@/modules/documents/utils/currency';
import {
  buildInvoiceDocumentModel,
  type SourceInvoice,
  type SourceCompany,
  type SourceCustomer,
} from '@/modules/documents/builder/from-invoice';

// توافق رجعي: تبقى الأنواع مُصدَّرة بأسمائها لمن يستوردها (شاشة تفاصيل الفاتورة).
export type InvoiceDoc = SourceInvoice;
export type Company = SourceCompany;
export type Customer = SourceCustomer;

/**
 * مستند الفاتورة الضريبية — الآن غلاف رفيع فوق محرّك المستندات:
 * يبني `DocumentModel` ويعرض القالب المسجَّل. مصدر واحد للشاشة/الطباعة/الـ PDF،
 * والمخرجات مطابقة للتصميم السابق (الثيم الافتراضي blue = هوية نبراس).
 */
export function InvoiceDocument({
  invoice,
  company,
  customer,
  qr,
  templateId,
}: {
  invoice: InvoiceDoc;
  company: Company | null;
  customer: Customer | null;
  qr: string | null;
  /** معرّف القالب من السجلّ؛ يتراجع للافتراضي إن غاب أو كان غير معروف. */
  templateId?: string | null;
}) {
  const descriptor = getTemplate(templateId);
  const Template = descriptor.component;
  const model = buildInvoiceDocumentModel({ invoice, company, customer, qr });
  const theme = getTheme(descriptor.defaultTheme);
  const formatMoney = makeMoneyFormatter(model.currency);

  return <Template model={model} theme={theme} formatMoney={formatMoney} />;
}
