import type { TemplateDescriptor } from '../types';
import { TaxInvoiceClassic } from '../templates/tax-invoice-classic';
import { TaxInvoiceModern } from '../templates/tax-invoice-modern';
import { TaxInvoiceErp } from '../templates/tax-invoice-erp';
import { TaxInvoiceMinimal } from '../templates/tax-invoice-minimal';
import { TaxInvoiceRetail } from '../templates/tax-invoice-retail';

/**
 * سجلّ القوالب — id ← مكوّن + بيانات وصفية. إضافة قالب جديد = إدخال واحد هنا،
 * دون لمس أي مستهلك (الفاتورة/الإعدادات تقرأ من السجلّ).
 */
export const TEMPLATES: Record<string, TemplateDescriptor> = {
  'tax-invoice-classic': {
    id: 'tax-invoice-classic',
    nameKey: 'classic',
    component: TaxInvoiceClassic,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'legal'],
  },
  'tax-invoice-modern': {
    id: 'tax-invoice-modern',
    nameKey: 'modern',
    component: TaxInvoiceModern,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter', 'legal'],
  },
  'tax-invoice-erp': {
    id: 'tax-invoice-erp',
    nameKey: 'erp',
    component: TaxInvoiceErp,
    defaultTheme: 'gray',
    supportedPaper: ['a4', 'letter', 'legal'],
  },
  'tax-invoice-minimal': {
    id: 'tax-invoice-minimal',
    nameKey: 'minimal',
    component: TaxInvoiceMinimal,
    defaultTheme: 'black',
    supportedPaper: ['a4', 'letter', 'legal'],
  },
  'tax-invoice-retail': {
    id: 'tax-invoice-retail',
    nameKey: 'retail',
    component: TaxInvoiceRetail,
    defaultTheme: 'blue',
    supportedPaper: ['a4', 'letter'],
  },
};

export const DEFAULT_TEMPLATE_ID = 'tax-invoice-classic';

export function getTemplate(id?: string | null): TemplateDescriptor {
  return TEMPLATES[id ?? DEFAULT_TEMPLATE_ID] ?? TEMPLATES[DEFAULT_TEMPLATE_ID];
}

export function listTemplates(): TemplateDescriptor[] {
  return Object.values(TEMPLATES);
}
