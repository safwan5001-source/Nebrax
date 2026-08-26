import type { Direction, DocumentLine, DocumentModel, DocumentTypeId } from '../types';

export type DocumentQaScenario = 'single' | 'five' | 'twenty' | 'multipage' | 'long_content';

export type DocumentQaOptions = {
  /** اختياري للتوافق مع فحوصات المرحلة الأولى؛ الافتراضي فاتورة ضريبية. */
  documentType?: DocumentTypeId;
  scenario: DocumentQaScenario;
  direction: Extract<Direction, 'rtl' | 'ltr'>;
  showQr: boolean;
  showAssets: boolean;
};

const LOGO_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="180" height="64" viewBox="0 0 180 64"%3E%3Crect width="180" height="64" rx="6" fill="%231e40af"/%3E%3Ctext x="90" y="40" text-anchor="middle" font-family="Arial" font-size="22" fill="white"%3ENebrax QA%3C/text%3E%3C/svg%3E';
const STAMP_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"%3E%3Ccircle cx="60" cy="60" r="51" fill="none" stroke="%231e40af" stroke-width="5"/%3E%3Ctext x="60" y="57" text-anchor="middle" font-family="Arial" font-size="17" fill="%231e40af"%3EQA%3C/text%3E%3Ctext x="60" y="78" text-anchor="middle" font-family="Arial" font-size="12" fill="%231e40af"%3EAPPROVED%3C/text%3E%3C/svg%3E';
const SIGNATURE_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="72" viewBox="0 0 200 72"%3E%3Cpath d="M8 49 C35 14, 43 56, 70 29 S105 55, 133 28 S165 48, 193 21" fill="none" stroke="%23111827" stroke-width="3"/%3E%3C/svg%3E';

function lineAt(index: number, direction: DocumentQaOptions['direction']): DocumentLine {
  const unitPrice = 12_500 + ((index % 7) * 1_000);
  const quantity = (index % 5) + 1;
  const subtotal = unitPrice * quantity;
  const tax = Math.round(subtotal * 0.15);
  const english = direction === 'ltr';
  const productName = english
    ? `Enterprise service line ${index + 1} with an extended descriptive commercial name`
    : `بند خدمة مؤسسية رقم ${index + 1} باسم تجاري وصفي ممتد للاختبار`;
  const description = english
    ? `Detailed line ${index + 1}: recurring operational service, configuration and support coverage for the stated billing period.`
    : `وصف تفصيلي للبند رقم ${index + 1}: خدمة تشغيلية دورية تشمل الإعداد والدعم للفترة المحاسبية المحددة.`;

  return {
    id: `qa-line-${index + 1}`,
    productName,
    productCode: `QA-SVC-${String(index + 1).padStart(3, '0')}`,
    barcode: `6281000${String(index + 1).padStart(6, '0')}`,
    description,
    quantity,
    priceBeforeTax: subtotal,
    unitPrice,
    tax,
    total: subtotal + tax,
  };
}

function countForScenario(scenario: DocumentQaScenario): number {
  return { single: 1, five: 5, twenty: 20, multipage: 40, long_content: 5 }[scenario];
}

function longArabicText(label: string): string {
  return `${label}: تُستخدم هذه الفقرة الطويلة للتحقق من بقاء النص العربي متصلاً ومقروءاً داخل مستند رسمي عند امتداده عبر أسطر متعددة، مع المحافظة على الهوامش والمحاذاة وعدم تجاوز عرض الصفحة أو فصل الأحرف العربية. `.repeat(5).trim();
}

function longEnglishText(label: string): string {
  return `${label}: this extended paragraph verifies that formal English document text remains readable when it spans multiple lines, preserves its margins and alignment, and does not overflow the page width or split meaningful content unexpectedly. `.repeat(5).trim();
}

/**
 * نماذج تحقق مرئية ثابتة وغير متصلة بالـ API. تستعمل في مسار QA التطويري فقط
 * كي تُختبر القوالب نفسها مع المحتوى الطويل والأصول والاتجاهين، من دون كتابة بيانات.
 */
export function makeDocumentQaModel(options: DocumentQaOptions): DocumentModel {
  const type = options.documentType ?? 'tax_invoice';
  const english = options.direction === 'ltr';
  const lines = Array.from({ length: countForScenario(options.scenario) }, (_, index) => lineAt(index, options.direction));
  const subtotal = lines.reduce((sum, line) => sum + (line.priceBeforeTax ?? 0), 0);
  const tax = lines.reduce((sum, line) => sum + line.tax, 0);
  const assets = options.showAssets;
  const longContent = options.scenario === 'multipage' || options.scenario === 'long_content';
  const isPurchaseDocument = type === 'purchase_order' || type === 'purchase_invoice';
  const isDeliveryNote = type === 'delivery_note';
  const dueDate = type === 'delivery_note' ? null : type === 'sales_order' || type === 'purchase_order' ? '2026-09-30' : '2026-09-25';
  const paymentType = type === 'purchase_invoice' || type === 'tax_invoice' ? 'credit' : null;

  return {
    type: type,
    currency: 'SAR',
    direction: options.direction,
    seller: {
      name: longContent
        ? (english ? 'Nebrax Enterprise Operations and Commercial Services Company for Integrated Financial Systems' : 'شركة نبراكس للعمليات المؤسسية والخدمات التجارية المتكاملة للأنظمة المالية')
        : (english ? 'Nebrax QA Trading Company' : 'شركة نبراكس التجريبية للتجارة'),
      vatNumber: '310122393500003',
      crNumber: '2050123456',
      city: english ? 'Dammam' : 'الدمام',
      address: longContent
        ? (english ? 'King Fahd Road, Al Faisaliyah District, Dammam, Eastern Province, Kingdom of Saudi Arabia' : 'طريق الملك فهد، حي الفيصلية، الدمام، المنطقة الشرقية، المملكة العربية السعودية')
        : (english ? 'King Fahd Road, Dammam' : 'طريق الملك فهد، الدمام'),
      phone: '+966 13 555 0101',
      mobile: '+966 50 555 0101',
      logoText: 'نـ',
      logoUrl: assets ? LOGO_DATA_URL : null,
      logoHeight: 56,
      tagline: english ? 'Enterprise financial operations' : 'إدارة مالية مؤسسية بثقة',
    },
    buyer: {
      name: longContent
        ? (isPurchaseDocument
          ? (english ? 'Gulf Regional Industrial Supplies and Logistics Establishment for Advanced Projects' : 'مؤسسة الخليج الإقليمية للتوريدات الصناعية واللوجستية للمشروعات المتقدمة')
          : (english ? 'Gulf Regional Customer and Project Delivery Establishment' : 'مؤسسة الخليج الإقليمية للعملاء وتسليم المشروعات والخدمات التجارية المتكاملة'))
        : (isPurchaseDocument
          ? (english ? 'Gulf Trading Supplier' : 'مؤسسة الخليج للتوريد')
          : (english ? 'Gulf Trading Customer' : 'مؤسسة الخليج للتجارة')),
      vatNumber: '311111111100003',
      crNumber: '2050987654',
      city: english ? 'Khobar' : 'الخبر',
      address: english ? 'King Saud Street, Khobar' : 'شارع الملك سعود، الخبر',
    },
    meta: {
      number: `${type.toUpperCase()}-QA-${options.scenario.toUpperCase()}-2026-0001`,
      date: '2026-08-26',
      dueDate,
      paymentType,
    },
    lines,
    totals: {
      subtotal,
      discount: 12_500,
      shipping: 7_500,
      adjustment: -2_500,
      tax,
      total: subtotal - 12_500 + 7_500 - 2_500 + tax,
    },
    qr: options.showQr && (type === 'tax_invoice' || type === 'simplified_tax_invoice') ? {
      value: `Nebrax QA ${options.direction} ${options.scenario} ${subtotal}`,
      note: english ? 'QA-only QR payload' : 'رمز تحقق خاص بالمعاينة',
    } : null,
    footerText: english ? 'This QA fixture is not a financial record and does not represent a posted document.' : 'هذه عينة تحقق لا تمثل سجلاً مالياً ولا مستنداً مرحّلاً.',
    notes: longContent
      ? (english ? longEnglishText(isDeliveryNote ? 'Delivery notes' : 'Internal notes') : longArabicText(isDeliveryNote ? 'ملاحظات التسليم' : 'ملاحظات داخلية'))
      : (english ? (isDeliveryNote ? 'Delivery received in good condition.' : 'QA note for document visual verification.') : (isDeliveryNote ? 'تم الاستلام بحالة جيدة.' : 'ملاحظة تحقق مرئية للمستند.')),
    terms: longContent
      ? (english ? longEnglishText('Terms and conditions') : longArabicText('الشروط والأحكام'))
      : (english ? 'Payment is due within 30 days from the issue date.' : 'تستحق الفاتورة خلال 30 يوماً من تاريخ الإصدار.'),
    bank: assets
      ? (english ? 'National Commercial Bank — IBAN SA0000000000000000000000 — Account: 1000000001' : 'البنك الأهلي السعودي — آيبان SA0000000000000000000000 — الحساب: 1000000001')
      : null,
    stampUrl: assets ? STAMP_DATA_URL : null,
    signatureUrl: assets ? SIGNATURE_DATA_URL : null,
  };
}
