/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterIconKeys, IconPicker } from '../IconPicker';
import { ICON_KEYS } from '../presentation/icon-registry';

const labels = { group: 'الأيقونة', search: 'ابحث عن أيقونة', none: 'بلا أيقونة', noResults: 'لا نتائج' };

afterEach(cleanup);

describe('filterIconKeys (VD-2)', () => {
  it('returns the whole registry for an empty query', () => {
    expect(filterIconKeys('')).toEqual([...ICON_KEYS]);
    expect(filterIconKeys('   ')).toEqual([...ICON_KEYS]);
  });

  it('matches Arabic labels, English labels, tags and keys', () => {
    expect(filterIconKeys('كعكة')).toContain('cake');
    expect(filterIconKeys('Graduation')).toContain('graduation-cap');
    expect(filterIconKeys('عيد ميلاد')).toContain('cake'); // tag, all words must match
    expect(filterIconKeys('paw')).toContain('paw-print');
  });

  it('ignores Arabic diacritics and case', () => {
    expect(filterIconKeys('تَخرّج')).toContain('graduation-cap');
    expect(filterIconKeys('CAKE')).toContain('cake');
  });

  it('returns nothing for an unknown term', () => {
    expect(filterIconKeys('zzzz-not-an-icon')).toEqual([]);
  });
});

describe('IconPicker (VD-2)', () => {
  it('lists every registry icon as a named, pressable 44px button', () => {
    render(<IconPicker value="gift" onChange={() => {}} locale="ar" labels={labels} />);
    const group = screen.getByRole('group', { name: 'الأيقونة' });
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(ICON_KEYS.length);
    const selected = screen.getByRole('button', { name: 'هدية' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(selected.className).toContain('size-11');
    expect(screen.getByRole('button', { name: 'كعكة' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits the registry key, never markup', () => {
    const onChange = vi.fn();
    render(<IconPicker value={undefined} onChange={onChange} locale="en" labels={labels} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cake' }));
    expect(onChange).toHaveBeenCalledWith('cake');
  });

  it('filters as the merchant types and says so when nothing matches', () => {
    render(<IconPicker value={undefined} onChange={() => {}} locale="ar" labels={labels} />);
    const search = screen.getByLabelText('ابحث عن أيقونة');
    fireEvent.change(search, { target: { value: 'تخرج' } });
    expect(screen.getByRole('button', { name: 'تخرّج' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'شاحنة' })).toBeNull();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByText('لا نتائج')).toBeTruthy();
  });

  it('offers a "no icon" choice only when allowed', () => {
    const onChange = vi.fn();
    const { rerender } = render(<IconPicker value="gift" onChange={onChange} locale="ar" labels={labels} />);
    expect(screen.queryByRole('button', { name: 'بلا أيقونة' })).toBeNull();
    rerender(<IconPicker value="gift" onChange={onChange} locale="ar" labels={labels} allowNone />);
    fireEvent.click(screen.getByRole('button', { name: 'بلا أيقونة' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('can be read-only', () => {
    render(<IconPicker value="gift" onChange={() => {}} locale="ar" labels={labels} disabled />);
    for (const button of screen.getByRole('group').querySelectorAll('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
