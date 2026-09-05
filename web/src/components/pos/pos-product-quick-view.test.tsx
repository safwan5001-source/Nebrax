// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosProductQuickView } from './pos-product-quick-view';

vi.mock('./pos-product-image', () => ({
  PosProductImage: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

const fields = {
  sku: 'SKU',
  barcode: 'Barcode',
  category: 'Category',
  units: 'Units',
  stock: 'Stock',
  outOfStock: 'Out of stock',
  inStock: 'Available',
  commercialSection: 'Commercial information',
  purchasePrice: 'Purchase price',
  avgCost: 'Average cost',
  profitMargin: 'Profit margin %',
};

const product = {
  id: 'p1',
  name: 'Water 330ml',
  sku: 'W330',
  barcode: '6281000000330',
  category: 'Beverages',
  sale_price_label: '1.50',
  pos_image: null,
  track_inventory: true,
  quantity_on_hand: 12,
  units: [{ name: 'piece', factor: 1 }, { name: 'carton', factor: 24 }],
};

describe('PosProductQuickView', () => {
  afterEach(() => cleanup());

  it('يعرض بيانات المنتج للقراءة فقط دون أي حقل تكلفة أو هامش ربح', () => {
    render(
      <PosProductQuickView open onClose={vi.fn()} product={product} title="Product details" fields={fields} />,
    );

    expect(screen.getByRole('heading', { name: 'Water 330ml' })).toBeTruthy();
    expect(screen.getByText('1.50')).toBeTruthy();
    expect(screen.getByText('W330')).toBeTruthy();
    expect(screen.getByText('6281000000330')).toBeTruthy();
    expect(screen.getByText('Beverages')).toBeTruthy();
    expect(screen.getByText('piece، carton')).toBeTruthy();
    expect(screen.getByText('Available: 12')).toBeTruthy();

    // لا حقل تكلفة/سعر شراء/هامش ربح مهما كانت الصلاحيات — بيانات حسّاسة
    // يقرّر كشفها الخادم لا الواجهة (انظر تقرير PR-2، قسم الأمان).
    expect(screen.queryByText(/cost/i)).toBeNull();
    expect(screen.queryByText(/margin/i)).toBeNull();
    expect(screen.queryByText(/purchase/i)).toBeNull();
  });

  it('يعرض «نفد المخزون» ولا يعرض عدد سلبياً أو صفرياً كأنه متاح', () => {
    render(
      <PosProductQuickView
        open
        onClose={vi.fn()}
        product={{ ...product, quantity_on_hand: 0 }}
        title="Product details"
        fields={fields}
      />,
    );
    expect(screen.getByText('Out of stock')).toBeTruthy();
    expect(screen.queryByText('Available: 0')).toBeNull();
  });

  it('لا يعرض «فتح في ERP» ما لم يُمرَّر مسار حقيقي', () => {
    render(
      <PosProductQuickView open onClose={vi.fn()} product={product} title="Product details" fields={fields} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('يعرض «فتح في ERP» فقط حين يُمرَّر مسار حقيقي، ويشير إلى مسار المنتج نفسه', () => {
    render(
      <PosProductQuickView
        open
        onClose={vi.fn()}
        product={product}
        title="Product details"
        fields={fields}
        openInErpHref="/products/p1"
        openInErpLabel="Open in ERP"
      />,
    );
    const link = screen.getByRole('link', { name: /Open in ERP/ });
    expect(link.getAttribute('href')).toBe('/products/p1');
  });

  it('يعرض التكلفة/سعر الشراء/الهامش فقط حين تصل فعلاً من استجابة الخادم (PR-2S)', () => {
    render(
      <PosProductQuickView
        open
        onClose={vi.fn()}
        product={{ ...product, purchase_price: '10.00', avg_cost: '9.50', profit_margin: 50 }}
        title="Product details"
        fields={fields}
      />,
    );
    expect(screen.getByText('Commercial information')).toBeTruthy();
    expect(screen.getByText('10.00')).toBeTruthy();
    expect(screen.getByText('9.50')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('لا يعرض قسم المعلومات التجارية إطلاقاً حين تغيب الحقول من الاستجابة (غير مُصرَّح)', () => {
    render(
      <PosProductQuickView open onClose={vi.fn()} product={product} title="Product details" fields={fields} />,
    );
    expect(screen.queryByText('Commercial information')).toBeNull();
  });

  it('لا يعرض صفاً وهمياً للهامش حين تكون القيمة null رغم وجود حقول تكلفة أخرى', () => {
    render(
      <PosProductQuickView
        open
        onClose={vi.fn()}
        product={{ ...product, purchase_price: '10.00', profit_margin: null }}
        title="Product details"
        fields={fields}
      />,
    );
    expect(screen.getByText('Commercial information')).toBeTruthy();
    expect(screen.getByText('10.00')).toBeTruthy();
    expect(screen.queryByText('Profit margin %')).toBeNull();
  });

  it('لا يعرض شيئاً حين لا يوجد منتج (لم يُحمَّل بعد أو أُغلق)', () => {
    const { container } = render(
      <PosProductQuickView open onClose={vi.fn()} product={null} title="Product details" fields={fields} />,
    );
    expect(container.textContent).toBe('');
  });
});
