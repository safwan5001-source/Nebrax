// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { ProductGiftingWorkspace } from './gifting-workspace';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const prep = (minutes: number | null) => ({ data: { preparation_minutes: minutes } });

function open(initial: number | null, opts: { canManage?: boolean; productId?: string; rejectSave?: ApiError } = {}) {
  let current = initial;
  const writes: unknown[] = [];
  apiMock.mockImplementation(async (_path: string, options?: { method?: string; body?: { preparation_minutes: number | null } }) => {
    if (options?.method === 'PUT') {
      if (opts.rejectSave) throw opts.rejectSave;
      writes.push(options.body);
      current = options.body!.preparation_minutes;
    }
    return prep(current);
  });
  const ui = (id: string) => (
    <ToastProvider>
      <ProductGiftingWorkspace productId={id} locale="en" canManage={opts.canManage ?? true} />
    </ToastProvider>
  );
  const view = renderIntl(ui(opts.productId ?? 'p1'), 'en');

  return { writes, rerender: (id: string) => view.rerender(ui(id)) };
}

describe('PreparationSection', () => {
  it('states honestly that an unset time follows the channel lead time only', async () => {
    open(0);
    expect(await screen.findByText('No product-specific time — follows the channel lead time only.')).toBeTruthy();
    expect(screen.getByText(/larger of the channel lead time/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Delivery settings' }).getAttribute('href')).toBe('/commerce/delivery');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the saved time in the best unit and saves a new value in minutes', async () => {
    const { writes } = open(180);
    expect(await screen.findByText('Product-specific time: 3 hours.')).toBeTruthy();
    expect((screen.getByLabelText('This product’s preparation time') as HTMLInputElement).value).toBe('3');

    const input = screen.getByLabelText('This product’s preparation time');
    await userEvent.clear(input);
    await userEvent.type(input, '2');
    await userEvent.selectOptions(screen.getByLabelText('Lead time unit'), 'days');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(writes).toEqual([{ preparation_minutes: 2880 }]));
    expect(await screen.findByText('Product-specific time: 2 days.')).toBeTruthy();
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('clearing the field removes the product-specific time (sends null)', async () => {
    const { writes } = open(90);
    const input = await screen.findByLabelText('This product’s preparation time');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes).toEqual([{ preparation_minutes: null }]));
    expect(await screen.findByText('No product-specific time — follows the channel lead time only.')).toBeTruthy();
  });

  it('refuses out-of-range input locally with a described error and no request', async () => {
    const { writes } = open(0);
    const input = await screen.findByLabelText('This product’s preparation time');
    await userEvent.type(input, '45');
    await userEvent.selectOptions(screen.getByLabelText('Lead time unit'), 'days');
    await userEvent.tab();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('prep-error');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(writes).toHaveLength(0);
  });

  it('is read-only without products.manage: no save controls, disabled fields, explanation', async () => {
    open(60, { canManage: false });
    const input = (await screen.findByLabelText('This product’s preparation time')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/view-only access/)).toBeTruthy();
  });

  it('shows the server rejection and keeps the draft; a missing product is a clear state', async () => {
    open(0, { rejectSave: new ApiError(422, 'مهلة التجهيز خارج المدى المسموح.', {}) });
    await userEvent.type(await screen.findByLabelText('This product’s preparation time'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('مهلة التجهيز خارج المدى المسموح.')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    cleanup();
    apiMock.mockReset();
    apiMock.mockRejectedValue(new ApiError(404, 'x', {}));
    renderIntl(<ToastProvider><ProductGiftingWorkspace productId="gone" locale="en" canManage /></ToastProvider>, 'en');
    expect((await screen.findAllByText('This product is not available.')).length).toBeGreaterThan(0);
  });

  it('does not apply a late response from the previously opened product', async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValue(prep(60));
    const view = renderIntl(<ToastProvider><ProductGiftingWorkspace productId="p1" locale="en" canManage /></ToastProvider>, 'en');
    view.rerender(<ToastProvider><ProductGiftingWorkspace productId="p2" locale="en" canManage /></ToastProvider>);
    expect(await screen.findByText('Product-specific time: 1 hour.')).toBeTruthy();
    resolveFirst(prep(1440));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('Product-specific time: 1 hour.')).toBeTruthy();
  });
});
