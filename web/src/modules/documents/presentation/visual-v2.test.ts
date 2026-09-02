import { describe, expect, it } from 'vitest';
import {
  VISUAL_V2,
  cappedLogoHeight,
  formatModernAmount,
  formatModernMoney,
  isNoticeStatus,
  localizedPair,
  modernCurrencyUnit,
  modernFieldLabel,
  modernItemsColumnWidthClass,
  modernItemsValueCellClass,
  modernMoneyColumnHeader,
  modernStatusLabel,
  pairLabel,
  resolveDocumentLabelMode,
  MODERN_DEFAULT_COLUMN_WIDTH_SUM,
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
    expect(VISUAL_V2.logoMaxPx).toBe(36);
    expect(VISUAL_V2.qrSizePx).toBe(76);
    expect(VISUAL_V2.qrSizePx).toBeLessThan(110);
    expect(VISUAL_V2.qrSizePx).toBeGreaterThanOrEqual(72);
    expect(VISUAL_V2.totalsMaxClass).toContain('max-w-[300px]');
  });

  it('لا يثبّت موضع الشعار بـ left/right الفيزيائي', () => {
    expect(VISUAL_V2.logoMaxWidthClass).not.toContain('object-right');
    expect(VISUAL_V2.logoMaxWidthClass).not.toContain('object-left');
  });
});

describe('cappedLogoHeight', () => {
  it('يقص الارتفاع فوق 36 بكسل ويستخدم السقف عند الغياب', () => {
    expect(cappedLogoHeight(56)).toBe(36);
    expect(cappedLogoHeight(null)).toBe(36);
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
    expect(modernItemsColumnWidthClass('number')).toBe('w-[3%]');
    expect(modernItemsColumnWidthClass('product_code')).toBe('w-[8%]');
    expect(modernItemsColumnWidthClass('barcode')).toBe('w-[8%]');
    expect(modernItemsColumnWidthClass('product')).toBe('w-[19%]');
    expect(modernItemsColumnWidthClass('description')).toBe('w-[21%]');
    expect(modernItemsColumnWidthClass('quantity')).toBe('w-[5%]');
    expect(modernItemsColumnWidthClass('unit_price')).toBe('w-[8%]');
    expect(modernItemsColumnWidthClass('price_before_tax')).toBe('w-[10%]');
    expect(modernItemsColumnWidthClass('tax')).toBe('w-[8%]');
    expect(modernItemsColumnWidthClass('total')).toBe('w-[10%]');
    expect(modernItemsValueCellClass('description')).toContain('break-words');
    expect(modernItemsValueCellClass('description')).toContain('text-[11px]');
    expect(modernItemsValueCellClass('product_code')).toContain('break-words');
    expect(modernItemsValueCellClass('product_code')).not.toContain('break-all');
    expect(modernItemsValueCellClass('barcode')).toContain('whitespace-nowrap');
    expect(modernItemsValueCellClass('barcode')).not.toContain('break-all');
    expect(modernItemsValueCellClass('total')).toContain('whitespace-nowrap');
  });

  it('يحافظ على مجموع نسب الأعمدة الافتراضية عند 100%', () => {
    expect(MODERN_DEFAULT_COLUMN_WIDTH_SUM).toBe(100);
  });
});

describe('Modern money presentation', () => {
  it('يعرض SAR كريال في العربية دون رمز الواجهة العام', () => {
    expect(modernCurrencyUnit('SAR', 'ar')).toBe('ريال');
    expect(formatModernAmount(100050, 'SAR')).toBe('1,000.50');
    expect(formatModernMoney(100050, 'SAR', 'ar')).toBe('1,000.50 ريال');
    expect(formatModernMoney(100050, 'SAR', 'ar')).not.toContain('SAR');
    expect(formatModernMoney(100050, 'SAR', 'ar')).not.toContain('﷼');
    expect(modernMoneyColumnHeader('الإجمالي', 'SAR', 'ar')).toBe('الإجمالي (ريال)');
  });

  it('يعرض SAR بالنص اللاتيني في الإنجليزية والوضع الثنائي', () => {
    expect(modernCurrencyUnit('SAR', 'en')).toBe('SAR');
    expect(modernCurrencyUnit('SAR', 'bilingual')).toBe('SAR');
    expect(formatModernMoney(100050, 'SAR', 'en')).toBe('1,000.50 SAR');
    expect(formatModernMoney(100050, 'SAR', 'bilingual')).toBe('1,000.50 SAR');
    expect(formatModernMoney(100050, 'SAR', 'en')).not.toContain('ريال');
    expect(formatModernMoney(100050, 'SAR', 'bilingual')).not.toContain('ريال');
    expect(formatModernMoney(100050, 'SAR', 'en')).not.toContain('﷼');
    expect(modernMoneyColumnHeader('Total', 'SAR', 'en')).toBe('Total (SAR)');
  });

  it('يبقي رمز العملات غير الريال من السجل القائم', () => {
    expect(modernCurrencyUnit('USD', 'ar')).toBe('$');
    expect(formatModernAmount(100050, 'USD')).toBe('1,000.50');
    expect(formatModernMoney(100050, 'USD', 'en')).toBe('1,000.50 $');
  });
});
