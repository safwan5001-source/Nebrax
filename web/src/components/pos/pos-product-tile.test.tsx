// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosProductTile } from './pos-product-tile';

vi.mock('./pos-product-image', () => ({
  PosProductImage: ({ alt, path }: { alt: string; path?: string | null }) => <span data-testid="pos-product-image" data-path={path ?? ''}>{alt}</span>,
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

  it('يخفي الباركود وSKU ومخزون الحالة الطبيعية عن وجه البطاقة', () => {
    renderTile();
    expect(screen.queryByTestId('pos-product-barcode')).toBeNull();
    expect(screen.queryByText('6281000000330')).toBeNull();
    expect(screen.queryByText('W330')).toBeNull();
    expect(screen.queryByTestId('pos-product-stock')).toBeNull();
    expect(screen.getByText('1.50')).toBeTruthy();
  });

  it('يظهر شارة الكمية الموجودة في السلة دون أن تمنع الإضافة', () => {
    const { onAdd } = renderTile({ cartQty: 2 });
    const badge = screen.getByTestId('pos-product-cart-qty');
    expect(badge.textContent).toBe('×2');
    fireEvent.click(screen.getByRole('button', { name: /Water 330ml/ }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('الوضع المضغوط لا يعرض صورة حتى لو كانت متاحة', () => {
    renderTile({ density: 'compact', showImage: false });
    expect(document.body.querySelector('[data-awj-media]')).toBeNull();
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

  it('لا يعرض مخزوناً عادياً فوق حد إعادة الطلب', () => {
    renderTile({
      product: { ...product, quantity_on_hand: 12, reorder_level: 5 },
      lowStockLabel: 'Low stock',
    });
    expect(screen.queryByTestId('pos-product-stock')).toBeNull();
    expect(screen.queryByTestId('pos-product-low-stock')).toBeNull();
  });

  // Floor posture (H4): the tile exposes inert markers the gated stylesheet keys on. They
  // carry no behavior and no text, and must not change the accessible structure.
  it('يحمل علامات Floor الخاملة دون تغيير بنيته الوصولية', () => {
    renderTile();
    const main = screen.getByRole('button', { name: /Water 330ml/ });
    expect(main.hasAttribute('data-awj-floor-tile')).toBe(true);
    expect(main.getAttribute('aria-selected')).toBe('false');
    expect(main.closest('[data-awj-floor-tile-wrap]')).not.toBeNull();
  });

  it('يميّز وسائط البلاطة: صورة فعلية أم مساحة بلا صورة', () => {
    const { container } = (() => {
      renderTile();
      return { container: document.body };
    })();
    expect(container.querySelector('[data-awj-media="image"]')).not.toBeNull();
    cleanup();
    renderTile({ product: { ...product, pos_image: null } });
    expect(document.body.querySelector('[data-awj-media="placeholder"]')).not.toBeNull();
    expect(document.body.querySelector('[data-awj-media="image"]')).toBeNull();
  });

  it('يفضّل مشتق card داخل البلاطة مع بقاء رابط الأصل احتياطاً', () => {
    renderTile({ product: { ...product, pos_image: { download_url: '/original.png', card_url: '/card.png' } } });
    expect(screen.getByTestId('pos-product-image').getAttribute('data-path')).toBe('/card.png');
  });

  it('أزرار المفضلة والمعلومات تبقى ≥ 44px لمساً (min-h-11/min-w-11)', () => {
    renderTile({ onOpenQuickView: vi.fn(), quickViewLabel: 'Quick view' });
    for (const name of ['Favorites', 'Quick view']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('min-w-11');
    }
  });
});
