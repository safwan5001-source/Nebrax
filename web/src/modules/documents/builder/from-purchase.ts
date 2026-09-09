import { riyalToMinor } from '@/lib/money';
import type { DocumentModel, Direction, DocumentLanguage } from '../types';
import type { SourceCompany, SourceCustomer } from './from-invoice';

/** أشكال مصدر فاتورة المشتريات كما يعيدها عقد الـ API، ومبالغها بالريال نصّاً. */
export interface SourcePurchaseLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  line_tax: string;
  line_total: string;
}

export interface SourcePurchase {
  number: string;
  purchase_date: string;
  due_date?: string | null;
  payment_type: string;
  subtotal: string;
  tax_amount: string;
  discount?: string;
  shipping?: string;
  adjustment?: string;
  total: string;
  notes?: string | null;
  lines: SourcePurchaseLine[];
  /**
   * `language_effective` هي القرار النهائي المحسوب في `PurchaseResource` عبر
   * `PrintTemplateContract::resolveEffectiveLanguage` — لقطة التجميد بعد
   * الترحيل، ثم قرار المسودة، ثم افتراضي المؤسسة، ثم `ar`. يُستهلك مباشرة إن
   * لم يمرِّر المستدعي `language` صريحاً في `input.language`.
   */
  language?: 'ar' | 'en' | 'bilingual' | null;
  language_frozen?: 'ar' | 'en' | 'bilingual' | null;
  language_effective?: 'ar' | 'en' | 'bilingual';
}

/**
 * يبني نموذج فاتورة مشتريات بالقيم المعروضة في الاستجابة. يبقى نوع المستند
 * `purchase_invoice` لكي تترجم الترويسة والأطراف وفق الشراء، ولا يعاد استخدام
 * عنوان فاتورة مبيعات في الإخراج الحراري.
 */
export function buildPurchaseDocumentModel(input: {
  purchase: SourcePurchase;
  company: SourceCompany | null;
  supplier: SourceCustomer | null;
  footerText?: string | null;
  logoUrl?: string | null;
  logoHeight?: number | null;
  terms?: string | null;
  bank?: string | null;
  stampUrl?: string | null;
  signatureUrl?: string | null;
  direction?: Direction;
  /**
   * لغة عرض المستند من الخلفية (`language_effective`). المسوّغ الوحيد لتمريرها
   * هنا صراحةً هو معاينة لغة لم تُحفَظ بعد؛ المستدعي المعتاد يترك القيمة تسقط
   * إلى `input.purchase.language_effective`.
   */
  language?: DocumentLanguage | null;
}): DocumentModel {
  const {
    purchase,
    company,
    supplier,
    footerText,
    logoUrl,
    logoHeight,
    terms,
    bank,
    stampUrl,
    signatureUrl,
  } = input;

  // أولوية الـprop الصريح ثم `language_effective` من عقد الـAPI، فالإسقاط إلى
  // `null` يُبقي سلوك ما قبل PR-LANG-2 حرفياً (اتجاهٌ ثابت `rtl`).
  const language = input.language ?? purchase.language_effective ?? null;
  // عندما تكون لغة المستند إنجليزية صريحة ولم يمرِّر المستدعي direction، اقلب
  // الاتجاه فعلياً — وإلا بقي RTL يعرض نصاً إنجليزياً بمحاذاة معكوسة.
  const direction: Direction = input.direction ?? (language === 'en' ? 'ltr' : 'rtl');

  return {
    type: 'purchase_invoice',
    currency: 'SAR',
    direction,
    language,
    seller: {
      name: company?.name ?? '—',
      vatNumber: company?.vat_number ?? null,
      crNumber: company?.cr_number ?? null,
      tagline: null,
      logoText: null,
      logoUrl: logoUrl && logoUrl.trim() !== '' ? logoUrl : (company?.logo ?? null),
      logoHeight: logoHeight ?? null,
    },
    buyer: {
      name: supplier?.name ?? '—',
      vatNumber: supplier?.vat_number ?? null,
      city: supplier?.city ?? null,
    },
    meta: {
      number: purchase.number,
      date: purchase.purchase_date,
      dueDate: purchase.due_date ?? null,
      paymentType: purchase.payment_type === 'cash' ? 'cash' : 'credit',
    },
    lines: purchase.lines.map((line) => ({
      id: line.id,
      description: line.description ?? '',
      quantity: line.quantity,
      unitPrice: riyalToMinor(line.unit_price),
      tax: riyalToMinor(line.line_tax),
      total: riyalToMinor(line.line_total),
    })),
    totals: {
      subtotal: riyalToMinor(purchase.subtotal),
      discount: riyalToMinor(purchase.discount ?? '0'),
      shipping: riyalToMinor(purchase.shipping ?? '0'),
      adjustment: riyalToMinor(purchase.adjustment ?? '0'),
      tax: riyalToMinor(purchase.tax_amount),
      total: riyalToMinor(purchase.total),
    },
    qr: null,
    footerText: footerText && footerText.trim() !== '' ? footerText : null,
    notes: purchase.notes ?? null,
    terms: terms && terms.trim() !== '' ? terms : null,
    bank: bank && bank.trim() !== '' ? bank : null,
    stampUrl: stampUrl && stampUrl.trim() !== '' ? stampUrl : null,
    signatureUrl: signatureUrl && signatureUrl.trim() !== '' ? signatureUrl : null,
  };
}
