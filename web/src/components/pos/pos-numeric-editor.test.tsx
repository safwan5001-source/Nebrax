// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosNumericEditor } from './pos-numeric-editor';

const labels = {
  apply: 'Apply',
  backspace: 'Delete last digit',
  cancel: 'Cancel',
  clear: 'Clear',
  decimal: 'Decimal separator',
  digit: (digit: string) => `Digit ${digit}`,
  value: 'Numeric value',
};

function renderEditor(overrides: Partial<ComponentProps<typeof PosNumericEditor>> = {}) {
  const onChange = vi.fn();
  render(
    <PosNumericEditor
      allowDecimal={false}
      inputAriaLabel="Quantity"
      labels={labels}
      onChange={onChange}
      showKeypad
      title="Edit quantity"
      value=""
      {...overrides}
    />,
  );
  return onChange;
}

describe('PosNumericEditor', () => {
  afterEach(() => cleanup());

  it('يطبق الأرقام والحذف والمسح والتأكيد مرة واحدة', () => {
    const onChange = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Quantity' }));

    fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Digit 2' }));
    expect((screen.getByRole('textbox', { name: 'Numeric value' }) as HTMLInputElement).value).toBe('12');

    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    expect((screen.getByRole('textbox', { name: 'Numeric value' }) as HTMLInputElement).value).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Digit 7' }));
    const form = screen.getByRole('dialog').querySelector('form');
    if (!form) throw new Error('Numeric editor form was not rendered');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('7');
  });

  it('يسمح بفاصل عشري واحد فقط عندما يحرر قيمة عشرية', () => {
    renderEditor({ allowDecimal: true, inputAriaLabel: 'Unit price', title: 'Edit unit price' });
    fireEvent.click(screen.getByRole('button', { name: 'Unit price' }));
    fireEvent.click(screen.getByRole('button', { name: 'Digit 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decimal separator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decimal separator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Digit 5' }));

    expect((screen.getByRole('textbox', { name: 'Numeric value' }) as HTMLInputElement).value).toBe('1.5');
  });

  it('يلغي المسودة عند Escape ولا يغير القيمة الأصلية', () => {
    const onChange = renderEditor({ value: '1' });
    fireEvent.click(screen.getByRole('button', { name: 'Quantity' }));
    fireEvent.click(screen.getByRole('button', { name: 'Digit 2' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('يبقي الإدخال النصي الأصلي متاحاً عندما تكون لوحة الأرقام معطلة', () => {
    const onChange = renderEditor({ showKeypad: false });
    const input = screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement;
    expect(input.inputMode).toBe('numeric');

    fireEvent.change(input, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith('4');
  });

  it('لا يعرض محرر لوحة الأرقام عندما تكون صلاحية التحرير محجوبة', () => {
    renderEditor({ editable: false, inputAriaLabel: 'Unit price' });

    expect(screen.queryByRole('button', { name: 'Unit price' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Unit price' })).toBeNull();
  });
});
