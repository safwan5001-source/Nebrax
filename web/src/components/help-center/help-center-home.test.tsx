// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpCenterHome } from './help-center-home';

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
  useTranslations: () => (key: string, values?: Record<string, number>) => values ? `${key}:${Object.values(values)[0]}` : key,
}));

afterEach(cleanup);

describe('HelpCenterHome', () => {
  it('exposes the Help search as a named searchbox', () => {
    render(<HelpCenterHome />);

    expect(screen.getByRole('searchbox', { name: 'searchTitle' })).toBeTruthy();
  });

  it('filters articles with Arabic search and clears the query', () => {
    render(<HelpCenterHome />);

    const input = screen.getByPlaceholderText('searchPlaceholder');
    fireEvent.change(input, { target: { value: 'جرد مخزني' } });

    expect(screen.getByText('تنفيذ جرد مخزني')).toBeTruthy();
    expect(screen.queryByText('إنشاء فاتورة مبيعات')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'clearSearch' }));
    expect(screen.getByText('إنشاء فاتورة مبيعات')).toBeTruthy();
  });

  it('opens a category and only lists its articles', () => {
    render(<HelpCenterHome />);

    fireEvent.click(screen.getByRole('button', { name: /المنتجات والمخزون/ }));

    expect(screen.getByText('إضافة منتج جديد')).toBeTruthy();
    expect(screen.getByText('تنفيذ جرد مخزني')).toBeTruthy();
    expect(screen.queryByText('إنشاء فاتورة مبيعات')).toBeNull();
  });

  it('shows an explicit empty state for unmatched searches', () => {
    render(<HelpCenterHome />);

    fireEvent.change(screen.getByPlaceholderText('searchPlaceholder'), { target: { value: 'مصطلح غير موجود إطلاقاً' } });

    expect(screen.getByText('noResults')).toBeTruthy();
    expect(screen.getByText('noResultsHint')).toBeTruthy();
  });
});
