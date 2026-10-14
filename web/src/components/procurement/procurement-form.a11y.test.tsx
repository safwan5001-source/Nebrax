// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { ToastProvider } from '@/components/ui/toast';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api', () => ({
  api: vi.fn(() => Promise.resolve({ data: [] })),
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/lib/use-number-preview', () => ({ useNumberPreview: () => ({ number: null, loading: false }) }));

import { ProcurementForm } from './procurement-form';

afterEach(cleanup);

describe('Procurement line controls are named (ERP-UX-H1-5B)', () => {
  it.each([
    ['ar', ['المنتج', 'الوصف', 'الكمية', 'الضريبة %']],
    ['en', ['Product', 'Description', 'Qty', 'Tax %']],
  ] as const)('names product, description, quantity and tax in %s', (locale, names) => {
    renderIntl(<ToastProvider><ProcurementForm type="order" /></ToastProvider>, locale);
    expect(screen.getByRole('combobox', { name: names[0] })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: names[1] })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: names[2] })).toBeTruthy();
    expect(screen.getByRole('spinbutton', { name: names[3] })).toBeTruthy();
  });
});
