import type { DocumentTypeId } from '@/modules/documents/types';

/**
 * بوابات مركز القوالب هي تنظيم واجهي مشتق من عقد أنواع المستندات، لا إعداد مؤسسة
 * ولا نوع بيانات جديد. كل نوع هنا يجب أن يبقى قابلاً للرسم عبر سجل المستندات.
 */
export type TemplateCenterFamilyId = 'sales' | 'purchases' | 'finance' | 'logistics';

export interface TemplateCenterFamily {
  id: TemplateCenterFamilyId;
  documentTypes: readonly DocumentTypeId[];
}

export const TEMPLATE_CENTER_FAMILIES: readonly TemplateCenterFamily[] = [
  {
    id: 'sales',
    documentTypes: [
      'tax_invoice',
      'simplified_tax_invoice',
      'quotation',
      'proforma_invoice',
      'sales_order',
      'credit_note',
    ],
  },
  {
    id: 'purchases',
    documentTypes: ['purchase_order', 'purchase_invoice', 'debit_note'],
  },
  {
    id: 'finance',
    documentTypes: ['receipt_voucher', 'payment_voucher', 'statement_of_account'],
  },
  {
    id: 'logistics',
    documentTypes: ['delivery_note', 'packing_list'],
  },
] as const;

export function filterTemplateCenterFamilies(
  query: string,
  labelForDocumentType: (type: DocumentTypeId) => string,
  labelForFamily: (family: TemplateCenterFamilyId) => string,
): TemplateCenterFamily[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...TEMPLATE_CENTER_FAMILIES];

  return TEMPLATE_CENTER_FAMILIES.flatMap((family) => {
    const familyMatches = labelForFamily(family.id).toLocaleLowerCase().includes(normalizedQuery);
    const matchingTypes = family.documentTypes.filter((type) => (
      familyMatches || labelForDocumentType(type).toLocaleLowerCase().includes(normalizedQuery)
    ));

    return matchingTypes.length ? [{ ...family, documentTypes: matchingTypes }] : [];
  });
}
