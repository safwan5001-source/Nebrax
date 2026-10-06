// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('next-intl', async (importOriginal) => ({ ...(await importOriginal<typeof import('next-intl')>()), useLocale: () => 'en' }));

import { CommerceStoreProvider } from '@/modules/commerce-workspace/store-context';
import { renderIntl } from '@/test-utils/intl';
import { StoreGate } from './store-gate';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const store = (id: string, name: string) => ({ id, name, sales_channel_id: `c-${id}`, is_active: true, default_locale: 'ar', business_vertical: 'flowers_gifts' });

function renderGate(stores: unknown[]) {
  apiMock.mockResolvedValue({ data: { stores } });
  return renderIntl(
    <CommerceStoreProvider>
      <StoreGate>{(s) => <p data-testid="child">child for {s.id}</p>}</StoreGate>
    </CommerceStoreProvider>,
    'en',
  );
}

describe('StoreGate', () => {
  it('shows a switchable store context on small screens when there are several stores, and remounts the child on switch', async () => {
    renderGate([store('s1', 'Rose House'), store('s2', 'Gift Corner')]);
    expect((await screen.findByTestId('child')).textContent).toBe('child for s1');
    const select = screen.getByLabelText('Current store') as HTMLSelectElement;
    expect(select.closest('[data-store-context]')?.className).toContain('md:hidden');
    await userEvent.selectOptions(select, 's2');
    expect(screen.getByTestId('child').textContent).toBe('child for s2');
  });

  it('shows just the store name when there is one store (nothing to switch)', async () => {
    renderGate([store('s1', 'Rose House')]);
    await screen.findByTestId('child');
    expect(document.querySelector('[data-store-context]')?.textContent).toContain('Rose House');
    expect(document.querySelector('[data-store-context] select')).toBeNull();
  });

  it('shows the empty-store state instead of the child when no store exists', async () => {
    renderGate([]);
    expect(await screen.findByText('No online store yet')).toBeTruthy();
    expect(screen.queryByTestId('child')).toBeNull();
  });
});
