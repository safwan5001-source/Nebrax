import type { SourceCompany } from './from-invoice';

/** يبني عنوان المؤسسة الوطني بدون أسطر فارغة. */
export function buildCompanyNationalAddress(company: SourceCompany | null): string | null {
  if (!company) return null;

  const parts = [
    company.building_no?.trim(),
    company.street?.trim(),
    company.additional_no?.trim(),
    company.district?.trim(),
    company.city?.trim(),
    company.postal_code?.trim(),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join('، ') : (company.short_address?.trim() || null);
}

/**
 * مصدر واحد لهوية البائع في جميع مستندات نبراكس.
 * Header يستهلك الهوية القانونية، وFooter يستهلك بيانات التواصل.
 */
export function buildDocumentSeller(
  company: SourceCompany | null,
  options: { logoUrl?: string | null; logoHeight?: number | null } = {},
) {
  const customLogo = options.logoUrl?.trim();

  return {
    name: company?.name ?? '—',
    nameEn: company?.name_en?.trim() || null,
    vatNumber: company?.vat_number ?? null,
    crNumber: company?.cr_number ?? null,
    unifiedNumber: company?.unified_number?.trim() || null,
    address: buildCompanyNationalAddress(company),
    city: company?.city?.trim() || null,
    phone: company?.phone?.trim() || null,
    mobile: company?.mobile?.trim() || null,
    email: company?.email?.trim() || null,
    website: company?.website?.trim() || null,
    supportNumber: company?.support_number ?? null,
    tagline: null,
    logoText: null,
    logoUrl: customLogo || company?.logo || null,
    logoHeight: options.logoHeight ?? null,
  };
}
