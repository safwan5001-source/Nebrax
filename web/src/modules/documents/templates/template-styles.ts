import type { TemplateStyle } from '../types';

/**
 * أساليب القوالب — نفس الأقسام، هويات بصرية مختلفة عبر توكنز.
 * `CLASSIC` مطابق للتصميم الأصلي (فلا يتغيّر مخرجه).
 */
export const CLASSIC_STYLE: TemplateStyle = {
  pagePadding: 'p-8',
  cardRadius: 'rounded-lg',
  sectionGap: 'mt-5',
  tableHead: 'brand',
};

/** Modern — مساحات أوسع، زوايا أنعم، رأس جدول خفيف. */
export const MODERN_STYLE: TemplateStyle = {
  pagePadding: 'p-10',
  cardRadius: 'rounded-2xl',
  sectionGap: 'mt-6',
  tableHead: 'soft',
};

/** ERP — كثيف، زوايا حادّة، رأس جدول تقليدي (بلا تعبئة). */
export const ERP_STYLE: TemplateStyle = {
  pagePadding: 'p-6',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-4',
  tableHead: 'plain',
};
