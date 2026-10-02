// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosCartEmptyState, PosCartLineFrame, PosCartQtyControls, PosCartRemoveButton, PosSelectedLineUnitControl } from './pos-cart-line-controls';

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

  // Floor posture (H4): selection is exposed to assistive tech and to the gated stylesheet
  // through aria-selected + an inert marker — never through color alone.
  it('يعلن التحديد عبر aria-selected ويحمل علامة Floor الخاملة', () => {
    render(
      <PosCartLineFrame selected scanned={false} onSelect={vi.fn()}>
        <span>Line A</span>
      </PosCartLineFrame>,
    );
    const option = screen.getByRole('option');
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(option.hasAttribute('data-awj-floor-line')).toBe(true);
    expect(option.getAttribute('tabindex')).toBe('0');
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

  it('PR-3: حالة آمنة حتمية بلا سطر محدَّد — الزر معطَّل ولا ينفّذ الحذف', () => {
    const onRemove = vi.fn();
    render(<PosCartRemoveButton label="Remove" onRemove={onRemove} disabled />);
    const button = screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onRemove).not.toHaveBeenCalled();
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

  it('PR-3: حالة آمنة حتمية بلا سطر محدَّد — كل الأزرار والمحرِّر معطَّلة', () => {
    const onDecrease = vi.fn();
    const onIncrease = vi.fn();
    render(
      <PosCartQtyControls
        qty={1}
        decreaseLabel="Decrease"
        increaseLabel="Increase"
        quantityLabel="Quantity"
        keypadTitle="Edit quantity"
        showKeypad={false}
        labels={labels}
        onDecrease={onDecrease}
        onIncrease={onIncrease}
        onQtyChange={vi.fn()}
        disabled
      />,
    );
    expect((screen.getByRole('button', { name: 'Increase' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Decrease' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Quantity') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onIncrease).not.toHaveBeenCalled();
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

describe('PosSelectedLineUnitControl', () => {
  it('يعرض قائمة فقط عند تمرير خيارات، والنص بخلاف ذلك (وحدة واحدة أو متغير)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PosSelectedLineUnitControl
        label="الوحدة"
        unitName="حبة"
        options={[
          { name: 'حبة', marker: ' (افتراضي)' },
          { name: 'كرتون', marker: '' },
        ]}
        onChange={onChange}
      />,
    );
    const select = screen.getByTestId('pos-line-unit-select') as HTMLSelectElement;
    expect(select.value).toBe('حبة');
    expect(select.options[0].textContent).toContain('افتراضي');
    fireEvent.change(select, { target: { value: 'كرتون' } });
    expect(onChange).toHaveBeenCalledWith('كرتون');

    rerender(<PosSelectedLineUnitControl label="الوحدة" unitName="حبة" options={null} onChange={onChange} />);
    expect(screen.queryByTestId('pos-line-unit-select')).toBeNull();
    expect(screen.getByTestId('pos-line-unit-text').textContent).toContain('حبة');

    rerender(<PosSelectedLineUnitControl label="الوحدة" unitName="أساس" options={null} onChange={onChange} />);
    expect(screen.queryByTestId('pos-line-unit-select')).toBeNull();
    expect(screen.getByTestId('pos-line-unit-text').textContent).toContain('أساس');
  });

  it('يرث اتجاه RTL وLTR من الحاوية ولا يفرض اتجاهاً خاصاً', () => {
    const { rerender } = render(
      <div dir="rtl">
        <PosSelectedLineUnitControl label="الوحدة" unitName="حبة" options={null} onChange={vi.fn()} />
      </div>,
    );
    const rtl = screen.getByTestId('pos-line-unit-text');
    expect(rtl.closest('[dir]')?.getAttribute('dir')).toBe('rtl');
    expect(rtl.getAttribute('dir')).toBeNull();

    rerender(
      <div dir="ltr">
        <PosSelectedLineUnitControl
          label="Unit"
          unitName="Piece"
          options={[{ name: 'Piece', marker: '' }, { name: 'Box', marker: '' }]}
          onChange={vi.fn()}
        />
      </div>,
    );
    const ltr = screen.getByTestId('pos-line-unit-select');
    expect(ltr.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
    expect(ltr.getAttribute('dir')).toBeNull();
  });
});
