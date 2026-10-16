import type { SourceCompany, SourceCustomer } from './from-invoice';

/**
 * REM-14c — لقطة البائع/المشتري لحظة إصدار الفاتورة كما يعيدها `GET /invoices/{id}` (`parties`).
 *
 * الخلفية تعيدها لفاتورة **مرحَّلة** ذات لقطة v1 فقط (وإلا `null`). الواجهة هنا لا تحسب شيئاً: تحوّل اللقطة إلى
 * الأشكال التي تستهلكها قوالب المستندات الحالية (`SourceCompany`/`SourceCustomer`) فلا نظام طباعة موازٍ.
 */
export interface InvoicePartiesSeller {
  name: string | null;
  vat_number: string | null;
  cr_number: string | null;
  country: string | null;
  address: {
    building_no: string | null;
    street: string | null;
    additional_no: string | null;
    district: string | null;
    city: string | null;
    postal_code: string | null;
    short_address: string | null;
  };
  phone: string | null;
  mobile: string | null;
  branch_id?: string | null;
}

export interface InvoicePartiesBuyer {
  partner_id: string | null;
  entity_type: string | null;
  name: string | null;
  name_en: string | null;
  vat_number: string | null;
  cr_number: string | null;
  address: {
    building_no: string | null;
    street: string | null;
    district: string | null;
    city: string | null;
    postal_code: string | null;
    country: string | null;
  };
}

export interface InvoiceParties {
  version: number;
  seller: InvoicePartiesSeller;
  buyer: InvoicePartiesBuyer;
}

const SUPPORTED_VERSION = 1;

/** لقطة سليمة يعرف هذا الكود تفسيرها (v1 ببنية كاملة)؛ وغير ذلك يُعامَل كأن لا لقطة. */
export function isUsableParties(parties: InvoiceParties | null | undefined): parties is InvoiceParties {
  return (
    !!parties
    && parties.version === SUPPORTED_VERSION
    && typeof parties.seller === 'object' && parties.seller !== null
    && typeof parties.buyer === 'object' && parties.buyer !== null
  );
}

/**
 * يحدّد بيانات الطرفين المعتمدة لعرض الفاتورة:
 *  • مرحَّلة بلقطة v1 ⇒ من اللقطة (الهوية القانونية والعنوان والتواصل) — لا تتأثر بتعديل العميل/المؤسسة لاحقاً.
 *    الشعار والعملة ليسا هوية قانونية فيبقيان من ملف المؤسسة الحي (`/me`) كما كانا.
 *  • مسودة، أو مرحَّلة قديمة (`parties = null`) ⇒ البيانات الحية كما هي: توافقٌ مع ما قبل REM-14
 *    وليس ضماناً تاريخياً.
 */
export function resolveInvoiceParties(input: {
  status?: string | null;
  parties?: InvoiceParties | null;
  company: SourceCompany | null;
  customer: SourceCustomer | null;
}): { company: SourceCompany | null; customer: SourceCustomer | null; source: 'snapshot' | 'live' } {
  const { status, parties, company, customer } = input;

  if (status === 'draft' || !isUsableParties(parties)) {
    return { company, customer, source: 'live' };
  }

  const { seller, buyer } = parties;
  return {
    source: 'snapshot',
    company: {
      name: seller.name ?? '—',
      vat_number: seller.vat_number,
      cr_number: seller.cr_number,
      phone: seller.phone,
      mobile: seller.mobile,
      building_no: seller.address?.building_no ?? null,
      street: seller.address?.street ?? null,
      additional_no: seller.address?.additional_no ?? null,
      district: seller.address?.district ?? null,
      city: seller.address?.city ?? null,
      postal_code: seller.address?.postal_code ?? null,
      short_address: seller.address?.short_address ?? null,
      // غير قانونيَّين: يبقيان حيّين.
      logo: company?.logo ?? null,
      currency: company?.currency ?? null,
    },
    customer: {
      name: buyer.name ?? '—',
      vat_number: buyer.vat_number,
      city: buyer.address?.city ?? null,
    },
  };
}
