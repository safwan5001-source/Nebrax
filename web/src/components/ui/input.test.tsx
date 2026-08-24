import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Input, normalizeGregorianDate } from './input';

describe('normalizeGregorianDate', () => {
  it('normalizes ISO and Arabic day/month/year input to an ISO Gregorian value', () => {
    expect(normalizeGregorianDate('2026-8-24')).toBe('2026-08-24');
    expect(normalizeGregorianDate('24/08/2026')).toBe('2026-08-24');
    expect(normalizeGregorianDate('٢٤/٠٨/٢٠٢٦')).toBe('2026-08-24');
  });

  it('does not force incomplete or invalid dates into a different value', () => {
    expect(normalizeGregorianDate('2026-08-')).toBe('2026-08-');
    expect(normalizeGregorianDate('2026-13-24')).toBe('2026-13-24');
  });
});

describe('Input date field', () => {
  it('uses a stable left-to-right Gregorian text field instead of the browser-localized native date control', () => {
    let changedValue = '';
    const onChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => {
      changedValue = event.currentTarget.value;
    });
    render(<Input aria-label="تاريخ الفاتورة" type="date" onChange={onChange} />);

    const input = screen.getByLabelText('تاريخ الفاتورة') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.dir).toBe('ltr');
    expect(input.lang).toBe('en-GB');
    expect(input.placeholder).toBe('YYYY-MM-DD');

    fireEvent.change(input, { target: { value: '24/08/2026' } });
    expect(changedValue).toBe('2026-08-24');
  });

  it('opens a Gregorian calendar and returns the selected ISO date to the form', () => {
    cleanup();
    let changedValue = '';
    const onChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => {
      changedValue = event.currentTarget.value;
    });
    const view = render(<Input aria-label="تاريخ الفاتورة" type="date" value="2026-08-24" onChange={onChange} />);

    fireEvent.click(view.getByRole('button', { name: 'فتح التقويم الميلادي' }));
    expect(view.getByRole('dialog', { name: 'التقويم الميلادي' })).toBeTruthy();
    expect(view.getByText('أغسطس 2026')).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'اختيار 2026-08-25' }));
    expect(changedValue).toBe('2026-08-25');
    expect(view.queryByRole('dialog', { name: 'التقويم الميلادي' })).toBeNull();
  });
});
