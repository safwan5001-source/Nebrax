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
  brandBar: true,
};

/** Modern — مساحات أوسع، زوايا أنعم، رأس جدول خفيف. */
export const MODERN_STYLE: TemplateStyle = {
  pagePadding: 'p-10',
  cardRadius: 'rounded-2xl',
  sectionGap: 'mt-6',
  tableHead: 'soft',
  brandBar: true,
};

/** ERP — كثيف، زوايا حادّة، رأس جدول تقليدي (بلا تعبئة). */
export const ERP_STYLE: TemplateStyle = {
  pagePadding: 'p-6',
  cardRadius: 'rounded-none',
  sectionGap: 'mt-4',
  tableHead: 'plain',
  brandBar: true,
};

/** Minimal — مساحات بيضاء كبيرة، بلا شريط هوية، رأس جدول هادئ. */
export const MINIMAL_STYLE: TemplateStyle = {
  pagePadding: 'p-12',
  cardRadius: 'rounded-lg',
  sectionGap: 'mt-8',
  tableHead: 'plain',
  brandBar: false,
};

/** Retail — مضغوط لنقاط البيع، مع باركود المستند. */
export const RETAIL_STYLE: TemplateStyle = {
  pagePadding: 'p-6',
  cardRadius: 'rounded-md',
  sectionGap: 'mt-4',
  tableHead: 'brand',
  brandBar: true,
};
