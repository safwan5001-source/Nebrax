import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('uses a stable left-to-right text field instead of the browser-localized native date control', () => {
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
});
