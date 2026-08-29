/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TechnicalDetails } from './technical-details';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TechnicalDetails', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it('stays collapsed by default and preserves nested JSON content', () => {
    const data = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      nested: { arr: [1, { deep: 'value' }], empty: {} },
      long: 'a'.repeat(120),
      missing: null,
    };
    const { container } = render(
      <TechnicalDetails title="تفاصيل تقنية" data={data} copyLabel="نسخ" copiedLabel="تم النسخ" />,
    );
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    fireEvent.click(screen.getByText('تفاصيل تقنية'));
    expect(details?.open).toBe(true);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(pre?.textContent).toContain('"deep": "value"');
    expect(pre?.textContent).toContain('null');
    expect(pre?.className).toContain('whitespace-pre-wrap');
    expect(pre?.className).toContain('min-w-0');
    expect(pre?.getAttribute('dir')).toBe('ltr');
  });

  it('copies the exact raw JSON when requested', async () => {
    render(
      <TechnicalDetails
        title="Technical details"
        data={{ ok: true }}
        copyLabel="Copy"
        copiedLabel="Copied"
        defaultOpen
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "ok": true\n}'));
  });
});
