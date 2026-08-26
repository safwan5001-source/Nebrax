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
 * Modern — هوية متوازنة بمساحة تنفس أوضح، ورأس مفصول بصرياً وملخص محاسبي نظيف.
 * لا يستعمل زوايا كبيرة أو ظلالاً حتى لا يتحول المستند إلى بطاقة واجهة.
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
