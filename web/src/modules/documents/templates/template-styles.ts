import type { TemplateStyle } from '../types';

/**
 * أساليب القوالب — تقرأ الأقسام المشتركة الهوية التركيبية من `composition`.
 * تبقى البيانات والتخطيط المخصص وعقود التصدير مستقلة عن هذه السمات العرضية.
 * `CLASSIC` و`RETAIL` يحتفظان بمخرجهما السابق.
 */
export const CLASSIC_STYLE: TemplateStyle = {
  composition: 'classic',
  pagePadding: 'p-8',
  cardRadius: 'rounded-lg',
  sectionGap: 'mt-5',
  tableHead: 'brand',
  tableDensity: 'comfortable',
  brandBar: true,
};

/**
 * Classic V2 — مستند رسمي تقليدي متوسط الكثافة، مستقل عن `tax-invoice-classic`
 * التاريخي وعن Modern/ERP V2. مربوط بـ `tax-invoice-classic-v2` فقط.
 */
export const CLASSIC_V2_STYLE: TemplateStyle = {
  composition: 'classic_v2',
  pagePadding: 'p-7',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-4',
  tableHead: 'plain',
  tableDensity: 'comfortable',
  brandBar: false,
};

export function isClassicV2(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'classic_v2';
}

export function isLegacyClassic(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'classic';
}

/**
 * Modern (تاريخي) — الشكل ما قبل #616. يبقى مربوطاً بـ `tax-invoice-modern`.
 * لا يُعاد تفسيره بعارض V2.
 */
export const MODERN_STYLE: TemplateStyle = {
  composition: 'modern',
  pagePadding: 'p-10',
  cardRadius: 'rounded-md',
  sectionGap: 'mt-7',
  tableHead: 'soft',
  tableDensity: 'comfortable',
  brandBar: false,
};

/**
 * Modern V2 — مستند مالي رسمي: فواصل رفيعة بلا بطاقات، ورأس جدول plain بلا شريط هوية.
 * مربوط بـ `tax-invoice-modern-v2` فقط.
 */
export const MODERN_V2_STYLE: TemplateStyle = {
  composition: 'modern_v2',
  pagePadding: 'p-8',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-4',
  tableHead: 'plain',
  tableDensity: 'comfortable',
  brandBar: false,
};

export function isModernV2(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'modern_v2';
}

export function isLegacyModern(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'modern';
}

/**
 * ERP — القالب المرجعي الكثيف: جدول عملي، فواصل حادة، وأولوية صارمة للأرقام.
 */
export const ERP_STYLE: TemplateStyle = {
  composition: 'erp',
  pagePadding: 'p-6',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-4',
  tableHead: 'plain',
  tableDensity: 'compact',
  brandBar: true,
};

/**
 * ERP V2 — دفتر يومي كثيف مستقل عن `tax-invoice-erp` التاريخي وعن Modern V2.
 * مربوط بـ `tax-invoice-erp-v2` فقط.
 */
export const ERP_V2_STYLE: TemplateStyle = {
  composition: 'erp_v2',
  pagePadding: 'p-5',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-3',
  tableHead: 'plain',
  tableDensity: 'compact',
  brandBar: false,
};

export function isErpV2(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'erp_v2';
}

export function isLegacyErp(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'erp';
}

/**
 * Minimal — يعتمد الطباعة والفواصل والبياض؛ لا شريط هوية ولا خلفيات زخرفية.
 */
export const MINIMAL_STYLE: TemplateStyle = {
  composition: 'minimal',
  pagePadding: 'p-12',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-8',
  tableHead: 'plain',
  tableDensity: 'spacious',
  brandBar: false,
};

/**
 * Minimal V2 — بياض وطبعة، مستقل عن `tax-invoice-minimal` التاريخي وعن عائلات V2 الأخرى.
 * مربوط بـ `tax-invoice-minimal-v2` فقط.
 */
export const MINIMAL_V2_STYLE: TemplateStyle = {
  composition: 'minimal_v2',
  pagePadding: 'p-10',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-6',
  tableHead: 'plain',
  tableDensity: 'spacious',
  brandBar: false,
};

export function isMinimalV2(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'minimal_v2';
}

export function isLegacyMinimal(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'minimal';
}

/** Retail — مضغوط لنقاط البيع، مع باركود المستند. */
export const RETAIL_STYLE: TemplateStyle = {
  composition: 'retail',
  pagePadding: 'p-6',
  cardRadius: 'rounded-md',
  sectionGap: 'mt-4',
  tableHead: 'brand',
  tableDensity: 'compact',
  brandBar: true,
};

/**
 * Retail V2 — تجاري سريع المسح، مستقل عن `tax-invoice-retail` التاريخي وعن عائلات V2 الأخرى.
 * مربوط بـ `tax-invoice-retail-v2` فقط.
 */
export const RETAIL_V2_STYLE: TemplateStyle = {
  composition: 'retail_v2',
  pagePadding: 'p-6',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-3',
  tableHead: 'plain',
  tableDensity: 'compact',
  brandBar: false,
};

export function isRetailV2(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'retail_v2';
}

export function isLegacyRetail(style: Pick<TemplateStyle, 'composition'>): boolean {
  return style.composition === 'retail';
}
