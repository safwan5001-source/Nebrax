/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatGregorianDate, Input, normalizeGregorianDate } from './input';

describe('Gregorian date formatting', () => {
  it('normalizes ISO and Arabic day/month/year input to an ISO Gregorian value', () => {
    expect(normalizeGregorianDate('2026-8-24')).toBe('2026-08-24');
    expect(normalizeGregorianDate('24/08/2026')).toBe('2026-08-24');
    expect(normalizeGregorianDate('٢٤/٠٨/٢٠٢٦')).toBe('2026-08-24');
  });

  it('displays canonical dates in day/month/year order with Latin digits', () => {
    expect(formatGregorianDate('2026-08-24')).toBe('24/08/2026');
    expect(formatGregorianDate('24/08/2026')).toBe('24/08/2026');
  });

  it('does not force incomplete or invalid dates into a different value', () => {
    expect(normalizeGregorianDate('2026-08-')).toBe('2026-08-');
    expect(normalizeGregorianDate('2026-13-24')).toBe('2026-13-24');
  });
});

describe('Input date field', () => {
  it('uses a stable left-to-right day/month/year field instead of the browser-localized native date control', () => {
    let changedValue = '';
    const onChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => {
      changedValue = event.currentTarget.value;
    });
    render(<Input aria-label="تاريخ الفاتورة" type="date" value="2026-08-24" onChange={onChange} />);

    const input = screen.getByLabelText('تاريخ الفاتورة') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.dir).toBe('ltr');
    expect(input.lang).toBe('en-GB');
    expect(input.placeholder).toBe('DD/MM/YYYY');
    expect(input.value).toBe('24/08/2026');

    fireEvent.change(input, { target: { value: '25/08/2026' } });
    expect(changedValue).toBe('2026-08-25');
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

  it('shows month and year controls after clicking the calendar heading', () => {
    cleanup();
    const view = render(<Input aria-label="تاريخ الفاتورة" type="date" value="2026-08-24" onChange={vi.fn()} />);

    fireEvent.click(view.getByRole('button', { name: 'فتح التقويم الميلادي' }));
    fireEvent.click(view.getByRole('button', { name: 'اختيار الشهر والسنة' }));

    expect((view.getByRole('combobox', { name: 'اختيار السنة' }) as HTMLSelectElement).value).toBe('2026');
    expect(view.getByRole('button', { name: 'اختيار سبتمبر' })).toBeTruthy();

    fireEvent.click(view.getByRole('button', { name: 'اختيار سبتمبر' }));
    expect(view.getByRole('button', { name: 'اختيار الشهر والسنة' }).getAttribute('aria-expanded')).toBe('false');
    expect(view.getByText('سبتمبر 2026')).toBeTruthy();
  });
});
