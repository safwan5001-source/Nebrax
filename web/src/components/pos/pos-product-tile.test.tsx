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
      taxLabel="incl. VAT"
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

  it('يعرض الباركود ولا يعرض SKU أو وسم الضريبة داخل البطاقة', () => {
    renderTile();
    expect(screen.getByText('6281000000330')).toBeTruthy();
    expect(screen.queryByText('W330')).toBeNull();
    expect(screen.queryByText('incl. VAT')).toBeNull();
    expect(screen.getByText('1.50')).toBeTruthy();
    expect(screen.getByText('Available: 12')).toBeTruthy();
  });
});
