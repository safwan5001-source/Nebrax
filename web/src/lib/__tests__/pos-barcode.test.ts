import { describe, expect, it } from 'vitest';
import { appendPosCartProduct, matchPosBarcode } from '@/lib/pos-barcode';

const product = {
  id: 'product-1',
  sku: 'SKU-001',
  barcode: '6281234567890',
  name: 'منتج اختبار',
  tax_rate: 15,
  pos_barcodes: [{ code: 'CARTON-001', unit_name: 'carton', default_quantity: 12 }],
};

describe('مطابقة باركود POS', () => {
  it('يطابق SKU والباركود الأساسيين بوحدة الأساس', () => {
    expect(matchPosBarcode([product], ' SKU-001 ')).toEqual({ product, unitName: null, quantity: 1, kind: 'base' });
    expect(matchPosBarcode([product], '6281234567890')).toEqual({ product, unitName: null, quantity: 1, kind: 'base' });
  });

  it('يطابق الباركود البديل بوحدته وكميته المحددتين', () => {
    expect(matchPosBarcode([product], 'CARTON-001')).toEqual({ product, unitName: 'carton', quantity: 12, kind: 'alternate' });
  });

  it('يعيد null لباركود غير معروف ولا يغير السلة', () => {
    expect(matchPosBarcode([product], 'UNKNOWN')).toBeNull();
  });

  it('يبقي منطق السلة كما هو: ينشئ السطر ثم يزيد كمية الوحدة المطابقة فقط', () => {
    const baseUnit = { name: 'piece', price: '10.00' };
    const first = appendPosCartProduct([], product, baseUnit, 1);
    const second = appendPosCartProduct(first, product, baseUnit, 3);
    const carton = appendPosCartProduct(second, product, { name: 'carton', price: '100.00' }, 12);

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ productId: product.id, unit: 'piece', qty: 4, price: '10.00' });
    expect(carton).toHaveLength(2);
    expect(carton[1]).toMatchObject({ productId: product.id, unit: 'carton', qty: 12, price: '100.00' });
  });
});

describe('VAR-POS-1 — متغيّرات المنتج في POS', () => {
  const black = { id: 'variant-black', sku: 'SHIRT-BLACK', descriptor: 'أسود / كبير', price: '20.00' };
  const white = { id: 'variant-white', sku: 'SHIRT-WHITE', descriptor: 'أبيض / صغير', price: '22.00' };
  const variantProduct = {
    id: 'product-variant-managed',
    sku: null,
    barcode: null,
    name: 'قميص',
    tax_rate: 15,
    pos_barcodes: [
      { code: 'BLACK-BC', unit_name: 'piece', default_quantity: 1, product_variant_id: black.id },
      { code: 'AMBIGUOUS-BC', unit_name: 'piece', default_quantity: 1, product_variant_id: null },
    ],
    pos_variants: [black, white],
  };

  it('لا يطابق الباركود الأساسي/SKU لمنتجٍ متعدد الخيارات إطلاقاً', () => {
    expect(matchPosBarcode([variantProduct], 'SHIRT-BLACK')).toBeNull();
  });

  it('باركودٌ بديل بلا متغيّرٍ محدَّد على منتجٍ متعدد الخيارات لا يُطابَق (لا مسار بيعٍ غامض)', () => {
    expect(matchPosBarcode([variantProduct], 'AMBIGUOUS-BC')).toBeNull();
  });

  it('باركودٌ يحدِّد متغيّراً فعلياً يعيد المتغيّر الصحيح مع المنتج والوحدة', () => {
    const match = matchPosBarcode([variantProduct], 'BLACK-BC');
    expect(match).toMatchObject({ product: variantProduct, unitName: 'piece', quantity: 1, kind: 'alternate', variant: black });
  });

  it('سطران لمتغيّرين شقيقين مختلفين بنفس الوحدة يبقيان مستقلَّين لا يندمجان', () => {
    const withBlack = appendPosCartProduct([], variantProduct, { name: 'piece', price: black.price }, 1, black);
    const withBoth = appendPosCartProduct(withBlack, variantProduct, { name: 'piece', price: white.price }, 1, white);

    expect(withBoth).toHaveLength(2);
    expect(withBoth[0]).toMatchObject({ productId: variantProduct.id, productVariantId: black.id, price: black.price });
    expect(withBoth[1]).toMatchObject({ productId: variantProduct.id, productVariantId: white.id, price: white.price });
  });

  it('نفس المتغيّر يُضاف مرّتين فيزيد الكمية لا يُنشئ سطراً ثانياً', () => {
    const first = appendPosCartProduct([], variantProduct, { name: 'piece', price: black.price }, 1, black);
    const second = appendPosCartProduct(first, variantProduct, { name: 'piece', price: black.price }, 2, black);

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ productVariantId: black.id, qty: 3 });
  });

  it('لقطة الوصف تُدرَج في وصف السطر — «اسم المنتج — تركيبة المتغيّر»', () => {
    const cart = appendPosCartProduct([], variantProduct, { name: 'piece', price: black.price }, 1, black);
    expect(cart[0].description).toBe('قميص — أسود / كبير');
  });
});
