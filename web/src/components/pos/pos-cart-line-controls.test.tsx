// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosCartEmptyState, PosCartLineFrame, PosCartQtyControls, PosCartRemoveButton } from './pos-cart-line-controls';

const labels = {
  apply: 'Apply',
  backspace: 'Backspace',
  cancel: 'Cancel',
  clear: 'Clear',
  decimal: 'Decimal',
  digit: (digit: string) => `Digit ${digit}`,
  value: 'Value',
};

afterEach(() => cleanup());

describe('PosCartLineFrame', () => {
  it('يحدد السطر عند الضغط عليه', () => {
    const onSelect = vi.fn();
    render(
      <PosCartLineFrame selected={false} scanned={false} onSelect={onSelect}>
        <span>Line A</span>
      </PosCartLineFrame>,
    );
    fireEvent.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('PosCartRemoveButton', () => {
  it('يمرّر الحذف عبر callback رقابي ولا يحدف مباشرة', () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    render(
      <PosCartLineFrame selected={false} scanned={false} onSelect={onSelect}>
        <PosCartRemoveButton label="Remove" onRemove={onRemove} />
      </PosCartLineFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('يبقى ظاهراً بدون hover ويحافظ على هدف لمس وfocus-visible', () => {
    render(<PosCartRemoveButton label="Remove" onRemove={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Remove' });
    expect(button.className).toMatch(/min-h-12/);
    expect(button.className).toMatch(/min-w-12/);
    expect(button.className).toMatch(/focus-visible:ring-2/);
    expect(button.className).not.toMatch(/opacity-0/);
    expect(button.className).not.toMatch(/group-hover/);
  });
});

describe('PosCartQtyControls', () => {
  it('يستدعي مسار الكمية القائم من أزرار اللمس', () => {
    const onDecrease = vi.fn();
    const onIncrease = vi.fn();
    const onQtyChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <PosCartLineFrame selected={false} scanned={false} onSelect={onSelect}>
        <PosCartQtyControls
          qty={2}
          decreaseLabel="Decrease"
          increaseLabel="Increase"
          quantityLabel="Quantity"
          keypadTitle="Edit quantity"
          showKeypad={false}
          labels={labels}
          onDecrease={onDecrease}
          onIncrease={onIncrease}
          onQtyChange={onQtyChange}
        />
      </PosCartLineFrame>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onIncrease).toHaveBeenCalledOnce();
    expect(onDecrease).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Increase' }).className).toMatch(/min-h-12/);
    expect(screen.getByRole('button', { name: 'Decrease' }).className).toMatch(/focus-visible:ring-2/);
  });
});

describe('PosCartEmptyState', () => {
  it('يعرض حالة فارغة مضغوطة بلا صندوق أيقونة ملوّن', () => {
    render(<PosCartEmptyState message="Cart is empty" />);
    const empty = screen.getByTestId('pos-cart-empty');
    expect(empty.textContent).toContain('Cart is empty');
    expect(empty.className).toMatch(/py-6/);
    expect(empty.className).not.toMatch(/py-10/);
    expect(empty.querySelector('[class*="bg-primary"]')).toBeNull();
  });
});
