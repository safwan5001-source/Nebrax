import type { TemplateDescriptor } from '../types';
import { TaxInvoiceClassic } from '../templates/tax-invoice-classic';
import { TaxInvoiceClassicV2 } from '../templates/tax-invoice-classic-v2';
import { TaxInvoiceModern } from '../templates/tax-invoice-modern';
import { TaxInvoiceModernV2 } from '../templates/tax-invoice-modern-v2';
import { TaxInvoiceErp } from '../templates/tax-invoice-erp';
import { TaxInvoiceErpV2 } from '../templates/tax-invoice-erp-v2';
import { TaxInvoiceMinimal } from '../templates/tax-invoice-minimal';
import { TaxInvoiceMinimalV2 } from '../templates/tax-invoice-minimal-v2';
import { TaxInvoiceRetail } from '../templates/tax-invoice-retail';
import { TaxReceiptThermal58, TaxReceiptThermal80 } from '../templates/thermal-receipt';

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
  'tax-invoice-classic-v2': {
    id: 'tax-invoice-classic-v2',
    nameKey: 'classic_v2',
    component: TaxInvoiceClassicV2,
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
  'tax-invoice-modern-v2': {
    id: 'tax-invoice-modern-v2',
    nameKey: 'modern_v2',
    component: TaxInvoiceModernV2,
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
  'tax-invoice-erp-v2': {
    id: 'tax-invoice-erp-v2',
    nameKey: 'erp_v2',
    component: TaxInvoiceErpV2,
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
  'tax-invoice-minimal-v2': {
    id: 'tax-invoice-minimal-v2',
    nameKey: 'minimal_v2',
    component: TaxInvoiceMinimalV2,
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
  'tax-invoice-thermal58': {
    id: 'tax-invoice-thermal58',
    nameKey: 'thermal58',
    component: TaxReceiptThermal58,
    defaultTheme: 'black',
    supportedPaper: ['thermal_58'],
  },
  'tax-invoice-thermal80': {
    id: 'tax-invoice-thermal80',
    nameKey: 'thermal80',
    component: TaxReceiptThermal80,
    defaultTheme: 'black',
    supportedPaper: ['thermal_80'],
  },
};

export const DEFAULT_TEMPLATE_ID = 'tax-invoice-classic';

export function getTemplate(id?: string | null): TemplateDescriptor {
  return TEMPLATES[id ?? DEFAULT_TEMPLATE_ID] ?? TEMPLATES[DEFAULT_TEMPLATE_ID];
}

export function listTemplates(): TemplateDescriptor[] {
  return Object.values(TEMPLATES);
}
