// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosVariantPickerDialog, type PosVariantPickerOption } from './pos-variant-picker-dialog';

vi.mock('./pos-product-image', () => ({
  PosProductImage: ({ path, alt }: { path?: string | null; alt: string }) => (
    <span data-testid="pos-product-image" data-path={path ?? ''} aria-label={alt} />
  ),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('./pos-dialog', () => ({
  PosDialog: ({ open, title, children }: { open: boolean; title: ReactNode; children: ReactNode }) =>
    open ? <div role="dialog" aria-label={typeof title === 'string' ? title : undefined}>{children}</div> : null,
}));

const black: PosVariantPickerOption = {
  id: 'v-black', sku: 'SHIRT-BLACK', descriptor: 'أسود / كبير', price: '150.00',
  image: { download_url: '/api/products/p1/media/m-black/download' },
};
const white: PosVariantPickerOption = {
  id: 'v-white', sku: 'SHIRT-WHITE', descriptor: 'أبيض / صغير', price: '160.00',
  image: null,
};

describe('PosVariantPickerDialog', () => {
  afterEach(() => cleanup());

  it('يعرض صورة كل متغيّر مصغَّرة عند show_product_images=true (الافتراضي)', () => {
    render(
      <PosVariantPickerDialog open productName="قميص" variants={[black, white]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    const images = screen.getAllByTestId('pos-product-image');
    expect(images).toHaveLength(2);
    expect(images[0]!.getAttribute('data-path')).toBe('/api/products/p1/media/m-black/download');
    // لا صورة محلولة لأبيض — يمرّ `undefined`/فارغ فيتولّى `PosProductImage` احتياطه القائم.
    expect(images[1]!.getAttribute('data-path')).toBe('');
  });

  it('لا يعرض أي صورة عند show_product_images=false — يطابق سلوك بطاقة المنتج', () => {
    render(
      <PosVariantPickerDialog
        open productName="قميص" variants={[black, white]} onSelect={vi.fn()} onClose={vi.fn()} showImages={false}
      />,
    );

    expect(screen.queryAllByTestId('pos-product-image')).toHaveLength(0);
    // النص والسعر يبقيان ظاهرين رغم إخفاء الصورة.
    expect(screen.getByText('أسود / كبير')).toBeTruthy();
    expect(screen.getByText('150.00')).toBeTruthy();
  });

  it('اختيار صفٍّ يستدعي onSelect بنفس بيانات المتغيّر كاملة (بما فيها الصورة)', () => {
    const onSelect = vi.fn();
    render(
      <PosVariantPickerDialog open productName="قميص" variants={[black, white]} onSelect={onSelect} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByText('أسود / كبير').closest('button')!);
    expect(onSelect).toHaveBeenCalledWith(black);
  });

  it('صفّان يشتركان في نفس صورة قيمة الخيار (أسود) يعرضان نفس المسار', () => {
    const blackM: PosVariantPickerOption = { ...black, id: 'v-black-m', descriptor: 'أسود / وسط' };
    render(
      <PosVariantPickerDialog open productName="قميص" variants={[black, blackM]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    const images = screen.getAllByTestId('pos-product-image');
    expect(images[0]!.getAttribute('data-path')).toBe(images[1]!.getAttribute('data-path'));
  });

  it('كل صفٍّ يبقي هدف لمسٍ لا يقل عن ٤٤ بكسل (min-h-11) ولا يكسر التخطيط الحالي', () => {
    render(
      <PosVariantPickerDialog open productName="قميص" variants={[black]} onSelect={vi.fn()} onClose={vi.fn()} />,
    );

    const button = screen.getByText('أسود / كبير').closest('button')!;
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('focus-visible:ring-2');
  });

  it('قائمة فارغة تعرض رسالة لا متغيّرات قابلة للبيع بدل صفوفٍ فارغة', () => {
    render(<PosVariantPickerDialog open productName="قميص" variants={[]} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('no_sellable_variants')).toBeTruthy();
    expect(screen.queryAllByTestId('pos-product-image')).toHaveLength(0);
  });
});
