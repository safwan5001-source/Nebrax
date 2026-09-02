import { describe, expect, it } from 'vitest';
import {
  VISUAL_V2,
  cappedLogoHeight,
  isNoticeStatus,
  localizedPair,
  modernFieldLabel,
  modernItemsColumnWidthClass,
  modernItemsValueCellClass,
  modernStatusLabel,
  pairLabel,
  resolveDocumentLabelMode,
  MODERN_ITEMS_HEAD_CLASS,
  MODERN_ITEMS_ROW_CLASS,
  MODERN_ITEMS_TABLE_CLASS,
} from './visual-v2';

describe('resolveDocumentLabelMode', () => {
  it('يعطي العربية عند واجهة عربية ومستند RTL', () => {
    expect(resolveDocumentLabelMode('ar', 'rtl')).toBe('ar');
  });

  it('يعطي الإنجليزية عند واجهة إنجليزية ومستند LTR', () => {
    expect(resolveDocumentLabelMode('en', 'ltr')).toBe('en');
  });

  it('يعطي وضعاً ثنائي اللغة عند اختلاف الاتجاه عن لغة الواجهة', () => {
    expect(resolveDocumentLabelMode('ar', 'ltr')).toBe('bilingual');
    expect(resolveDocumentLabelMode('en', 'rtl')).toBe('bilingual');
  });
});

describe('pairLabel', () => {
  it('لا يكرر قيمة مشتركة في الوضع الثنائي', () => {
    expect(pairLabel('INV-1', 'INV-1', 'bilingual')).toBe('INV-1');
  });

  it('يركب تسمية ثنائية بالعربية أولاً', () => {
    expect(pairLabel('الرقم الضريبي', 'VAT No.', 'bilingual')).toBe('الرقم الضريبي | VAT No.');
  });

  it('يرجع لغة واحدة حسب الوضع', () => {
    expect(pairLabel('التاريخ', 'Date', 'ar')).toBe('التاريخ');
    expect(pairLabel('التاريخ', 'Date', 'en')).toBe('Date');
  });
});

describe('localizedPair', () => {
  it('يحافظ على العربية أولاً حتى لو كانت الواجهة إنجليزية', () => {
    expect(localizedPair('en', 'Tax Invoice', 'فاتورة ضريبية', 'bilingual')).toBe('فاتورة ضريبية | Tax Invoice');
    expect(localizedPair('ar', 'فاتورة ضريبية', 'Tax Invoice', 'bilingual')).toBe('فاتورة ضريبية | Tax Invoice');
  });
});

describe('modernFieldLabel', () => {
  it('يختصر الرقم الضريبي في الوضع الثنائي', () => {
    expect(modernFieldLabel('vat_number', 'bilingual')).toBe('الرقم الضريبي | VAT No.');
  });
});

describe('isNoticeStatus', () => {
  it('يميّز المسودة والملغى فقط ولا يوسّم المرحّل', () => {
    expect(isNoticeStatus('draft')).toBe(true);
    expect(isNoticeStatus('cancelled')).toBe(true);
    expect(isNoticeStatus('posted')).toBe(false);
    expect(isNoticeStatus(null)).toBe(false);
  });
});

describe('modernStatusLabel', () => {
  it('يركب شارة المسودة ثنائياً بالعربية أولاً', () => {
    expect(modernStatusLabel('draft', 'bilingual')).toBe('مسودة | Draft');
    expect(modernStatusLabel('cancelled', 'ar')).toBe('ملغاة');
  });
});

describe('VISUAL_V2', () => {
  it('يبقي الشعار وQR ضمن حدود لا تهيمن على الصفحة', () => {
    expect(VISUAL_V2.logoMaxPx).toBeLessThanOrEqual(48);
    expect(VISUAL_V2.qrSizePx).toBeLessThan(110);
    expect(VISUAL_V2.qrSizePx).toBeGreaterThanOrEqual(72);
  });

  it('لا يثبّت موضع الشعار بـ left/right الفيزيائي', () => {
    expect(VISUAL_V2.logoMaxWidthClass).not.toContain('object-right');
    expect(VISUAL_V2.logoMaxWidthClass).not.toContain('object-left');
  });
});

describe('cappedLogoHeight', () => {
  it('يقص الارتفاع فوق 48 بكسل ويستخدم السقف عند الغياب', () => {
    expect(cappedLogoHeight(56)).toBe(48);
    expect(cappedLogoHeight(null)).toBe(48);
    expect(cappedLogoHeight(32)).toBe(32);
  });
});

describe('modern items table tokens', () => {
  it('يثبّت table-fixed ويمنع تناوب الصفوف الملوّن', () => {
    expect(MODERN_ITEMS_TABLE_CLASS).toContain('table-fixed');
    expect(MODERN_ITEMS_HEAD_CLASS).not.toContain('doc-brand');
    expect(MODERN_ITEMS_ROW_CLASS).not.toContain('doc-brand-soft');
    expect(MODERN_ITEMS_ROW_CLASS).not.toContain('bg-');
  });

  it('يعطي الوصف والمنتج عرضاً مرناً ولفّاً آمناً والأرقام nowrap', () => {
    expect(modernItemsColumnWidthClass('description')).toBe('w-[22%]');
    expect(modernItemsColumnWidthClass('product')).toBe('w-[22%]');
    expect(modernItemsColumnWidthClass('total')).toBe('w-[12%]');
    expect(modernItemsValueCellClass('description')).toContain('break-words');
    expect(modernItemsValueCellClass('total')).toContain('whitespace-nowrap');
  });
});
