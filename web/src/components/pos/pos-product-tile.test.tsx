// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosProductTile } from './pos-product-tile';

vi.mock('./pos-product-image', () => ({
  PosProductImage: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

const product = {
  id: 'p1',
  name: 'Water 330ml',
  sku: 'W330',
  barcode: '6281000000330',
  sale_price_label: '1.50',
  pos_image: { download_url: '/img.png' },
  track_inventory: true,
  quantity_on_hand: 12,
};

function renderTile(overrides: Partial<Parameters<typeof PosProductTile>[0]> = {}) {
  const onAdd = vi.fn();
  const onToggleFavorite = vi.fn();
  render(
    <PosProductTile
      product={product}
      showImage
      selected={false}
      isFavorite={false}
      availableLabel="Available"
      favoriteLabel="Favorites"
      onAdd={onAdd}
      onToggleFavorite={onToggleFavorite}
      onFocus={vi.fn()}
      {...overrides}
    />,
  );
  return { onAdd, onToggleFavorite };
}

describe('PosProductTile', () => {
  afterEach(() => cleanup());

  it('يضيف المنتج بضغطة واحدة على البطاقة ويتبع التكرار نفس المسار', () => {
    const { onAdd } = renderTile();
    const card = screen.getByRole('button', { name: /Water 330ml/ });
    fireEvent.click(card);
    fireEvent.click(card);
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('لا يضيف المنتج عند الضغط على المفضلة', () => {
    const { onAdd, onToggleFavorite } = renderTile();
    const favorite = screen.getByRole('button', { name: 'Favorites' });
    expect(favorite.className).toContain('min-h-11');
    expect(favorite.className).toContain('min-w-11');
    fireEvent.click(favorite);
    expect(onToggleFavorite).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('يبقي aria-selected للحلقات الكيبوردية دون فرضها بعد اللمس', () => {
    renderTile({ selected: false });
    expect(screen.getByRole('button', { name: /Water 330ml/ }).getAttribute('aria-selected')).toBe('false');
    cleanup();
    const { onAdd: onAddSelected } = renderTile({ selected: true });
    expect(screen.getByRole('button', { name: /Water 330ml/ }).getAttribute('aria-selected')).toBe('true');
    expect(onAddSelected).toBeDefined();
  });

  it('يحافظ على حالات اللمس والماوس والكيبورد داخل البطاقة', () => {
    renderTile();
    const card = screen.getByRole('button', { name: /Water 330ml/ });
    expect(card.className).toContain('touch-manipulation');
    expect(card.className).toContain('hover:border-primary');
    expect(card.className).toContain('focus-visible:ring-2');
  });

  it('يعرض الباركود ويخفي SKU داخل البطاقة', () => {
    renderTile();
    expect(screen.getByTestId('pos-product-barcode').textContent).toContain('6281000000330');
    expect(screen.queryByText('W330')).toBeNull();
    expect(screen.getByText('1.50')).toBeTruthy();
    expect(screen.getByText('Available: 12')).toBeTruthy();
  });

  it('يثبّت اتجاه الباركود LTR ويترك المخزون في سطر مستقل', () => {
    renderTile();
    const barcode = screen.getByText('6281000000330');
    const stock = screen.getByText('Available: 12');
    const barcodeRow = screen.getByTestId('pos-product-barcode');
    const stockRow = screen.getByTestId('pos-product-stock');
    expect(barcode.getAttribute('dir')).toBe('ltr');
    expect(barcodeRow.contains(barcode)).toBe(true);
    expect(stockRow.contains(stock)).toBe(true);
    expect(barcodeRow).not.toBe(stockRow);
  });

  it('لا يعرض باركودًا وهميًا عند عدم وجود باركود حقيقي', () => {
    renderTile({ product: { ...product, barcode: null } });
    expect(screen.queryByTestId('pos-product-barcode')).toBeNull();
    expect(screen.queryByText('W330')).toBeNull();
  });

  it('لا يعرض زر Quick View إن لم يُمرَّر onOpenQuickView (توافق رجعي)', () => {
    renderTile();
    expect(screen.queryByRole('button', { name: /Quick view/i })).toBeNull();
  });

  it('يفتح Quick View دون إضافة المنتج للسلة، ولا يمرّر النقر للبطاقة الرئيسية', () => {
    const onAdd = vi.fn();
    const onOpenQuickView = vi.fn();
    render(
      <PosProductTile
        product={product}
        showImage
        selected={false}
        isFavorite={false}
        availableLabel="Available"
        favoriteLabel="Favorites"
        quickViewLabel="Quick view"
        onAdd={onAdd}
        onToggleFavorite={vi.fn()}
        onOpenQuickView={onOpenQuickView}
        onFocus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(onOpenQuickView).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('يعرض «نفد المخزون» حين تكون الكمية صفراً أو أقل، ولا يمنع الإضافة', () => {
    const { onAdd } = renderTile({
      product: { ...product, quantity_on_hand: 0 },
      outOfStockLabel: 'Out of stock',
    });
    expect(screen.getByTestId('pos-product-stock').textContent).toBe('Out of stock');
    fireEvent.click(screen.getByRole('button', { name: /Water 330ml/ }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('يعرض «مخزون منخفض» حين تصل الكمية إلى حد إعادة الطلب دون نفاده، في سطر مستقل كامل غير مقصوص', () => {
    renderTile({
      product: { ...product, quantity_on_hand: 3, reorder_level: 5 },
      lowStockLabel: 'Low stock',
    });
    // سطران مستقلان لا نصّ واحد مدموج — يمنع بتر «Low stock» عند عرض البطاقة
    // العادي (الثغرة البصرية المكتشفة والمصلَحة هنا).
    expect(screen.getByText('Available: 3')).toBeTruthy();
    const lowStockLine = screen.getByTestId('pos-product-low-stock');
    expect(lowStockLine.textContent).toBe('Low stock');
    expect(lowStockLine.className).toContain('text-warning');
    expect(lowStockLine.className).not.toContain('text-negative');
  });

  it('لا يعرض تنبيه مخزون منخفض فوق حد إعادة الطلب', () => {
    renderTile({
      product: { ...product, quantity_on_hand: 12, reorder_level: 5 },
      lowStockLabel: 'Low stock',
    });
    expect(screen.getByTestId('pos-product-stock').textContent).toBe('Available: 12');
  });
});
