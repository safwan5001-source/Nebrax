// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosCartLineFrame, PosCartQtyControls, PosCartRemoveButton } from './pos-cart-line-controls';

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
});
