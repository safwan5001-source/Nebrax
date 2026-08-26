import type { Company } from '@/lib/company';

/**
 * حقول هوية موسعة اختيارية. وجودها هنا لا يفترض أن API الحالي يعيدها؛
 * بل يسمح للعقد نفسه باستيعابها عند توسيع ملف الشركة دون تغيير العارض.
 */
export type DocumentCompanyIdentitySource = Company & {
  name_en?: string | null;
  unified_number?: string | null;
  email?: string | null;
  website?: string | null;
};

export interface DocumentIdentityField {
  key: 'vat_number' | 'cr_number' | 'unified_number' | 'address';
  value: string;
}

export interface DocumentContactField {
  key: 'phone' | 'mobile' | 'email' | 'website' | 'support_number';
  value: string;
}

export interface DocumentCompanyIdentity {
  nameAr: string;
  nameEn: string | null;
  logoUrl: string | null;
  legal: DocumentIdentityField[];
  contact: DocumentContactField[];
}

function clean(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function compactAddress(company: DocumentCompanyIdentitySource): string | null {
  const structured = [
    clean(company.building_no),
    clean(company.street),
    clean(company.district),
    clean(company.city),
    clean(company.postal_code),
  ].filter((value): value is string => Boolean(value));

  if (structured.length) return structured.join('، ');
  return clean(company.short_address);
}

/**
 * معيار هوية مستندات نبراكس:
 * Header = الاسم والهوية القانونية فقط.
 * Footer = بيانات التواصل فقط.
 * لا تُنشأ أسطر فارغة ولا تُنسخ بيانات التواصل إلى الترويسة.
 */
export function buildDocumentCompanyIdentity(company: DocumentCompanyIdentitySource): DocumentCompanyIdentity {
  const legal: DocumentIdentityField[] = [];
  const contact: DocumentContactField[] = [];

  const vat = clean(company.vat_number);
  const cr = clean(company.cr_number);
  const unified = clean(company.unified_number);
  const address = compactAddress(company);

  if (vat) legal.push({ key: 'vat_number', value: vat });
  if (cr) legal.push({ key: 'cr_number', value: cr });
  if (unified) legal.push({ key: 'unified_number', value: unified });
  if (address) legal.push({ key: 'address', value: address });

  const phone = clean(company.phone);
  const mobile = clean(company.mobile);
  const email = clean(company.email);
  const website = clean(company.website);
  const support = clean(company.support_number);

  if (phone) contact.push({ key: 'phone', value: phone });
  if (mobile) contact.push({ key: 'mobile', value: mobile });
  if (email) contact.push({ key: 'email', value: email });
  if (website) contact.push({ key: 'website', value: website });
  if (support) contact.push({ key: 'support_number', value: support });

  return {
    nameAr: clean(company.name) ?? '—',
    nameEn: clean(company.name_en),
    logoUrl: clean(company.logo),
    legal,
    contact,
  };
}
