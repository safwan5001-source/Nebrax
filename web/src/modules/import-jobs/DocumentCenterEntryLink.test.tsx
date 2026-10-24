// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentCenterEntryLink } from './DocumentCenterEntryLink';

const { api, user } = vi.hoisted(() => ({
  api: vi.fn(),
  user: { current: { id: 'u1', role: 'accountant', permissions: ['documents.center.view'] } as { id: string; role: string; permissions?: string[] } | null },
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api }));
vi.mock('@/lib/use-can', () => ({ useCurrentUser: () => user.current }));
vi.mock('lucide-react', () => ({ FileText: () => <span /> }));

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ data: {} });
  user.current = { id: 'u1', role: 'accountant', permissions: ['documents.center.view'] };
});
afterEach(cleanup);

describe('DocumentCenterEntryLink (IMP-H5-S6)', () => {
  it('links to the Document Center with the hint for the document kind', async () => {
    const { rerender } = render(<DocumentCenterEntryLink kind="purchase" />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/applications/nav-state'));

    expect((screen.getByRole('link', { name: 'open' }) as HTMLAnchorElement).getAttribute('href')).toBe('/documents');
    expect(screen.getByText('purchase_hint')).toBeTruthy();
    rerender(<DocumentCenterEntryLink kind="expense" />);
    expect(screen.getByText('expense_hint')).toBeTruthy();
  });

  it('is hidden while the capability is off, so it never leads to a dead end', async () => {
    api.mockResolvedValue({ data: { 'document_center.core': false } });
    render(<DocumentCenterEntryLink kind="purchase" />);

    await waitFor(() => expect(screen.queryByRole('link', { name: 'open' })).toBeNull());
  });

  it('is hidden without the view permission', async () => {
    user.current = { id: 'u1', role: 'staff', permissions: ['purchases.view'] };
    render(<DocumentCenterEntryLink kind="purchase" />);

    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'open' })).toBeNull();
  });

  it('stays visible when the capability state cannot be fetched', async () => {
    api.mockRejectedValue(new Error('network'));
    render(<DocumentCenterEntryLink kind="expense" />);

    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'open' })).toBeTruthy();
  });
});
