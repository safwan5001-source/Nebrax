// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { ScopePicker } from '@/components/developer/scope-picker';
import { API_SCOPES } from '@/lib/developer';

afterEach(cleanup);

describe('scope picker', () => {
  it('renders every contract scope as its exact technical string, grouped by resource', () => {
    renderIntl(<ScopePicker scopes={API_SCOPES} value={[]} onChange={() => {}} />);
    for (const scope of API_SCOPES) {
      expect(screen.getByText(scope)).toBeTruthy(); // النصّ التقني محفوظ حرفياً
    }
    // مجموعات الموارد ظاهرة (عربي)
    expect(screen.getByText('الأطراف')).toBeTruthy();
    expect(screen.getByText('المنتجات')).toBeTruthy();
  });

  it('selecting a scope emits its exact string, not a label', () => {
    const onChange = vi.fn();
    renderIntl(<ScopePicker scopes={API_SCOPES} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('partners:read'));
    expect(onChange).toHaveBeenCalledWith(['partners:read']);
  });

  it('distinguishes read from write', () => {
    renderIntl(<ScopePicker scopes={['partners:read', 'partners:write']} value={['partners:write']} onChange={() => {}} />, 'en');
    expect(screen.getAllByText('Read').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Write').length).toBeGreaterThan(0);
  });

  it('surfaces a validation error', () => {
    renderIntl(<ScopePicker scopes={API_SCOPES} value={[]} onChange={() => {}} error="مطلوب نطاق" />);
    expect(screen.getByRole('alert').textContent).toContain('مطلوب نطاق');
  });
});
