/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRiyal } from '@/lib/money';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformPricesPage from './page';

const { platformApi, replace, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {}
  return { platformApi: vi.fn(), replace: vi.fn(), ApiError };
});
let locale: 'en' | 'ar' = 'en';
let authenticated = true;

function makeTranslator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).platformPrices[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { en: makeTranslator('en'), ar: makeTranslator('ar') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale] }));
const router = { replace, push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => authenticated }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError }));

const price = (id: string, plan: string, amount: string, effective_on: string | null, created = '2026-01-01T10:00:00+00:00') => ({
  id, plan, currency: 'SAR', monthly_amount: amount, monthly_amount_minor: Math.round(Number(amount) * 100), effective_on, created_at: created,
});
const catalogue = () => ({
  data: [
    price('b-now', 'basic', '99.00', '2026-03-01'),
    price('p-new', 'pro', '1999.50', '2026-12-01'),
    price('p-now', 'pro', '199.99', '2026-06-01'),
    price('p-old', 'pro', '149.00', '2025-06-01'),
  ],
});
const t = (key: string, values?: Record<string, string>) => translators.en(key, values);
const posts = () => platformApi.mock.calls.filter(([, o]) => o?.method === 'POST');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T09:00:00Z'));
  locale = 'en';
  authenticated = true;
  platformApi.mockReset();
  replace.mockReset();
  platformApi.mockResolvedValue(catalogue());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderLoaded() {
  const utils = render(<PlatformPricesPage />);
  await screen.findAllByText(formatRiyal('199.99'));
  return utils;
}

describe('platform prices UX (H1-4C)', () => {
  it('has no private back link, one h1, labelled sections', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(Array.from(container.querySelectorAll('section[aria-labelledby]')).map((s) => document.getElementById(s.getAttribute('aria-labelledby') as string)?.textContent)).toEqual([
      t('summaryTitle'), t('newPrice'), t('history'),
    ]);
  });

  it('shows each API amount exactly as formatRiyal formats the API string, in the catalogue and the summary', async () => {
    await renderLoaded();
    for (const amount of ['99.00', '1999.50', '199.99', '149.00']) {
      expect(screen.getAllByText(formatRiyal(amount)).length).toBeGreaterThan(0);
    }
    // no amount is derived: the sum or an averaged value never appears
    expect(screen.queryByText(formatRiyal('2348.49'))).toBeNull();
  });

  it('separates in-effect, scheduled and superseded versions by date, in the summary and the history', async () => {
    await renderLoaded();
    const summary = document.getElementById('prices-summary')?.closest('section') as HTMLElement;
    const proCard = within(summary).getByText('pro').closest('[data-awj-card]') as HTMLElement;
    expect(within(proCard).getByText(formatRiyal('199.99'))).toBeTruthy();
    expect(within(proCard).getByText('2026-06-01')).toBeTruthy();
    expect(proCard.textContent).toContain('Since 2026-06-01');
    expect(within(proCard).getByText(t('nextScheduled'))).toBeTruthy();
    expect(within(proCard).getByText(formatRiyal('1999.50'))).toBeTruthy();
    expect(proCard.textContent).toContain('Starts 2026-12-01');

    const rows = screen.getAllByRole('row');
    const rowFor = (amount: string) => rows.find((row) => row.textContent?.includes(formatRiyal(amount))) as HTMLElement;
    expect(within(rowFor('1999.50')).getByText(t('statusScheduled'))).toBeTruthy();
    expect(within(rowFor('199.99')).getByText(t('statusCurrent'))).toBeTruthy();
    expect(within(rowFor('149.00')).getByText(t('statusSuperseded'))).toBeTruthy();
  });

  it('never treats a scheduled version as current and says the status is derived from dates', async () => {
    platformApi.mockResolvedValue({ data: [price('only', 'pro', '500.00', '2026-12-01')] });
    render(<PlatformPricesPage />);
    expect(await screen.findAllByText(t('statusScheduled'))).not.toHaveLength(0);
    expect(screen.queryByText(t('statusCurrent'))).toBeNull();
    expect(screen.getByText(t('noCurrentPrice'))).toBeTruthy();
    expect(screen.getByText(t('summaryNote'))).toBeTruthy();
  });

  it('does not pick between versions that share the latest effective date', async () => {
    platformApi.mockResolvedValue({ data: [price('a', 'pro', '100.00', '2026-06-01'), price('b', 'pro', '120.00', '2026-06-01')] });
    render(<PlatformPricesPage />);
    expect((await screen.findAllByText(t('tiedDate'))).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatRiyal('100.00')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(formatRiyal('120.00')).length).toBeGreaterThan(0);
  });

  it('keeps the signed-out redirect and requests nothing', async () => {
    authenticated = false;
    render(<PlatformPricesPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/platform/login'));
    expect(platformApi).not.toHaveBeenCalled();
  });

  describe('creating a price version', () => {
    const fill = (amount: string, date?: string) => {
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value: amount } });
      if (date) fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: date } });
    };

    it('typing and previewing send nothing; the preview echoes the amount and the integer minor units', async () => {
      await renderLoaded();
      const before = platformApi.mock.calls.length;
      fill('199.50', '2026-12-25');
      const preview = screen.getByTestId('price-preview');
      expect(preview.textContent).toContain(`basic · ${formatRiyal('199.50')} monthly · effective 2026-12-25`);
      // dates and amounts are isolated left-to-right so an RTL page cannot reorder them
      expect(preview.querySelectorAll('bdi[dir="ltr"]').length).toBeGreaterThanOrEqual(3);
      expect(within(preview).getByText(t('previewScheduled'))).toBeTruthy();
      expect(within(preview).getByText('Sent to the server as 19950 halalas.')).toBeTruthy();
      expect(platformApi.mock.calls.length).toBe(before);
      expect(posts()).toHaveLength(0);
    });

    it('a date of today or earlier previews as applying to contracts starting then', async () => {
      await renderLoaded();
      fill('10', '2026-10-12');
      expect(within(screen.getByTestId('price-preview')).getByText(t('previewEffective'))).toBeTruthy();
    });

    it('posts the same payload: plan, SAR, integer minor units, effective date', async () => {
      await renderLoaded();
      platformApi.mockResolvedValueOnce({ data: price('new', 'basic', '199.50', '2026-12-25', '2026-10-12T09:00:00+00:00') });
      fireEvent.change(screen.getByLabelText(t('plan')), { target: { value: 'basic' } });
      fill('199.50', '2026-12-25');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]).toEqual(['/platform/prices', { method: 'POST', body: { plan: 'basic', currency: 'SAR', monthly_amount: 19950, effective_on: '2026-12-25' } }]);
      expect(Number.isInteger(posts()[0]?.[1].body.monthly_amount)).toBe(true);
    });

    it('normalises Arabic digits and separators to the same integer, never a float', async () => {
      await renderLoaded();
      platformApi.mockResolvedValueOnce({ data: price('new', 'basic', '1234.56', '2026-12-25') });
      fill('١٬٢٣٤٫٥٦', '2026-12-25');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]?.[1].body.monthly_amount).toBe(123456);
    });

    it('rejects a malformed or negative amount without a request, with an inline hint', async () => {
      await renderLoaded();
      for (const bad of ['12.345', 'abc', '-5']) {
        fill(bad, '2026-12-25');
        expect(screen.getByLabelText(t('monthlyPrice')).getAttribute('aria-invalid')).toBe('true');
        expect(screen.queryByTestId('price-preview')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: t('save') }));
        expect((await screen.findByRole('alert')).textContent).toBe(t('invalidAmount'));
      }
      expect(posts()).toHaveLength(0);
    });

    it('announces success as status with the saved values and the date-derived state, and adds the version to the history', async () => {
      await renderLoaded();
      const created = price('new', 'basic', '110.00', '2026-12-25', '2026-10-12T09:00:00+00:00');
      platformApi.mockResolvedValueOnce({ data: created });
      platformApi.mockResolvedValueOnce({ data: [...catalogue().data, created] }); // the reload after every save
      fill('110', '2026-12-25');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      const status = await screen.findByRole('status');
      expect(status.textContent).toContain(t('saved'));
      expect(status.textContent).toContain(`basic · ${formatRiyal('110.00')} monthly · effective 2026-12-25`);
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Scheduled until 2026-12-25'));
      expect(screen.getAllByText(formatRiyal('110.00')).length).toBeGreaterThan(0);
      expect((screen.getByLabelText(t('monthlyPrice')) as HTMLInputElement).value).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('labels a retroactive version as superseded in the confirmation, matching its row in the history', async () => {
      await renderLoaded();
      const retro = price('retro', 'pro', '99.00', '2026-01-01', '2026-10-12T09:00:00+00:00');
      platformApi.mockResolvedValueOnce({ data: retro });
      platformApi.mockResolvedValueOnce({ data: [...catalogue().data, retro] });
      fireEvent.change(screen.getByLabelText(t('plan')), { target: { value: 'pro' } });
      fill('99', '2026-01-01');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t('savedSuperseded')));
      const status = screen.getByRole('status');
      expect(status.textContent).not.toContain(t('savedEffective'));
      const row = screen.getAllByRole('row').find((r) => r.textContent?.startsWith('pro') && r.textContent.includes(formatRiyal('99.00'))) as HTMLElement;
      expect(within(row).getByText(t('statusSuperseded'))).toBeTruthy();
    });

    it('a failed save shows the server message as an alert next to the form and keeps the history', async () => {
      await renderLoaded();
      platformApi.mockRejectedValueOnce(new ApiError('Date must not be in the past'));
      fill('110', '2026-12-25');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      expect((await screen.findByRole('alert')).textContent).toBe('Date must not be in the past');
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getAllByText(formatRiyal('199.99')).length).toBeGreaterThan(0);
      expect((screen.getByLabelText(t('monthlyPrice')) as HTMLInputElement).value).toBe('110');
    });

    it('labels are tied to controls and the primary action is 44px', async () => {
      await renderLoaded();
      for (const label of [t('plan'), t('monthlyPrice'), t('effectiveOn')]) {
        expect(screen.getByLabelText(label).className).toContain('h-11');
      }
      expect(screen.getByRole('button', { name: t('save') }).className).toContain('h-11');
    });
  });

  it('shows a load failure as an alert with a 44px retry, keeps the form, and retry reloads', async () => {
    platformApi.mockRejectedValueOnce(new ApiError('not allowed'));
    render(<PlatformPricesPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('not allowed');
    expect(screen.getByLabelText(t('monthlyPrice'))).toBeTruthy();
    const retry = screen.getByRole('button', { name: t('retry') });
    expect(retry.className).toContain('h-11');
    fireEvent.click(retry);
    expect((await screen.findAllByText(formatRiyal('199.99'))).length).toBeGreaterThan(0);
  });

  describe('a save after a failed first load', () => {
    const saveOne = async () => {
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value: '110' } });
      fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: '2026-12-25' } });
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
    };

    it('reloads the catalogue, clears the stale error and shows the new version with the rest', async () => {
      platformApi.mockRejectedValueOnce(new ApiError('temporary outage'));
      render(<PlatformPricesPage />);
      await screen.findByRole('alert');
      const created = price('new', 'basic', '110.00', '2026-12-25');
      platformApi.mockResolvedValueOnce({ data: created });
      platformApi.mockResolvedValueOnce({ data: [...catalogue().data, created] });
      await saveOne();
      expect((await screen.findByRole('status')).textContent).toContain(t('saved'));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(screen.getAllByText(formatRiyal('110.00')).length).toBeGreaterThan(0);
      expect(screen.getAllByText(formatRiyal('199.99')).length).toBeGreaterThan(0);
      const gets = platformApi.mock.calls.filter(([, o]) => !o?.method);
      expect(gets).toHaveLength(2);
      // the state label comes from the complete catalogue
      expect(screen.getByRole('status').textContent).toContain('Scheduled until 2026-12-25');
    });

    it('never labels the saved version from an incomplete list while the catalogue is still unavailable', async () => {
      platformApi.mockRejectedValueOnce(new ApiError('temporary outage'));
      render(<PlatformPricesPage />);
      await screen.findByRole('alert');
      platformApi.mockResolvedValueOnce({ data: price('new', 'basic', '110.00', '2026-01-01') });
      platformApi.mockRejectedValueOnce(new ApiError('still down'));
      await saveOne();
      const status = await screen.findByRole('status');
      expect(status.textContent).toContain(t('saved'));
      for (const key of ['savedEffective', 'savedSuperseded']) expect(status.textContent).not.toContain(t(key));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('still down'));
    });
  });

  describe('preview of an unsaved version', () => {
    const fill = (value: string, date: string, planValue = 'pro') => {
      fireEvent.change(screen.getByLabelText(t('plan')), { target: { value: planValue } });
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value } });
      fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: date } });
    };

    it('says a retroactive date behind a later in-effect version is superseded, and matches the saved status', async () => {
      await renderLoaded();
      fill('120', '2026-01-01'); // pro already has a June 2026 version in effect
      const preview = screen.getByTestId('price-preview');
      expect(preview.textContent).toContain(t('previewSuperseded'));
      expect(preview.textContent).not.toContain(t('previewEffective'));
      expect(posts()).toHaveLength(0);
      const retro = price('retro', 'pro', '120.00', '2026-01-01');
      platformApi.mockResolvedValueOnce({ data: retro });
      platformApi.mockResolvedValueOnce({ data: [...catalogue().data, retro] });
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t('savedSuperseded')));
    });

    it('describes a superseded version by its date window, not as unusable for every new contract', async () => {
      await renderLoaded();
      fill('120', '2026-01-01');
      const text = screen.getByTestId('price-preview').textContent ?? '';
      expect(text).toContain("on or after this date and before that later version's date"); // inclusive, as scopeEffectiveOn is
      expect(text).not.toMatch(/will not apply to new contracts\./);
    });

    it('flags a date that already exists for the plan, which the unique key would reject, without blocking the request', async () => {
      await renderLoaded();
      fill('120', '2026-06-01'); // pro already has 2026-06-01
      expect(screen.getByTestId('price-preview').textContent).toContain(t('previewDuplicate'));
      fill('120', '2026-12-01'); // a future duplicate too
      expect(screen.getByTestId('price-preview').textContent).toContain(t('previewDuplicate'));
      expect((screen.getByRole('button', { name: t('save') }) as HTMLButtonElement).disabled).toBe(false);
      expect(posts()).toHaveLength(0);
    });

    it('keeps the other outcomes: scheduled for a future date, in effect for a newer past date', async () => {
      await renderLoaded();
      fill('120', '2026-12-25');
      expect(screen.getByTestId('price-preview').textContent).toContain(t('previewScheduled'));
      fill('120', '2026-07-01');
      expect(screen.getByTestId('price-preview').textContent).toContain(t('previewEffective'));
    });

    it('does not claim the version applies while the catalogue is not loaded', async () => {
      platformApi.mockReset();
      platformApi.mockRejectedValueOnce(new ApiError('outage'));
      render(<PlatformPricesPage />);
      await screen.findByRole('alert');
      fill('120', '2026-01-01');
      const preview = screen.getByTestId('price-preview');
      expect(preview.textContent).toContain(t('previewUnverified'));
      expect(preview.textContent).not.toContain(t('previewEffective'));
    });
  });

  describe('statuses after a save come from a fresh catalogue', () => {
    it('reloads after every successful save, so a version another administrator added is taken into account', async () => {
      platformApi.mockReset();
      // this tab only knows a January version of pro
      platformApi.mockResolvedValueOnce({ data: [price('p-jan', 'pro', '100.00', '2026-01-01')] });
      render(<PlatformPricesPage />);
      await screen.findAllByText(formatRiyal('100.00'));
      // meanwhile another administrator added September; this tab adds June
      const june = price('p-jun', 'pro', '120.00', '2026-06-01');
      const sep = price('p-sep', 'pro', '150.00', '2026-09-01');
      const reload = (() => { let resolve!: (v: unknown) => void; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
      platformApi.mockResolvedValueOnce({ data: june }); // POST
      platformApi.mockReturnValueOnce(reload.promise); // reload, still pending
      fireEvent.change(screen.getByLabelText(t('plan')), { target: { value: 'pro' } });
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value: '120' } });
      fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: '2026-06-01' } });
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      const status = await screen.findByRole('status');
      // no state is claimed from the stale list while the reload is pending
      for (const key of ['savedEffective', 'savedSuperseded', 'savedScheduled']) expect(status.textContent).not.toContain(t(key));
      reload.resolve({ data: [sep, june, price('p-jan', 'pro', '100.00', '2026-01-01')] });
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain(t('savedSuperseded')));
      expect(screen.getByRole('status').textContent).not.toContain(t('savedEffective'));
      expect(platformApi.mock.calls.filter(([, o]) => !o?.method)).toHaveLength(2);
    });
  });

  describe('previews while the catalogue is being refreshed', () => {
    const fill = (value: string, date: string) => {
      fireEvent.change(screen.getByLabelText(t('plan')), { target: { value: 'pro' } });
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value } });
      fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: date } });
    };

    it('does not describe a past date from the pre-save list while the reload is pending, and recovers when it lands', async () => {
      await renderLoaded();
      const retro = price('retro', 'pro', '99.00', '2026-01-01');
      let resolve!: (v: unknown) => void;
      const reload = new Promise((r) => { resolve = r; });
      platformApi.mockResolvedValueOnce({ data: retro }); // POST
      platformApi.mockReturnValueOnce(reload); // reload pending
      fill('99', '2026-01-01');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await screen.findByRole('status');
      // a second retroactive version: the pre-save list would call it effective
      fill('88', '2026-02-01');
      const during = screen.getByTestId('price-preview').textContent ?? '';
      expect(during).toContain(t('previewUnverified'));
      expect(during).not.toContain(t('previewEffective'));
      expect(during).not.toContain(t('previewSuperseded'));
      resolve({ data: [...catalogue().data, retro] });
      await waitFor(() => expect(screen.getByTestId('price-preview').textContent).toContain(t('previewSuperseded')));
    });

    it('stays unverified for a past date if the reload fails, but a future date is still scheduled', async () => {
      await renderLoaded();
      platformApi.mockResolvedValueOnce({ data: price('retro', 'pro', '99.00', '2026-01-01') }); // POST
      platformApi.mockRejectedValueOnce(new ApiError('reload failed')); // reload
      fill('99', '2026-01-01');
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await screen.findByRole('alert');
      fill('88', '2026-02-01');
      expect(screen.getByTestId('price-preview').textContent).toContain(t('previewUnverified'));
      fill('88', '2026-12-30');
      expect(screen.getByTestId('price-preview').textContent).toContain(t('previewScheduled'));
    });
  });

  describe('summary and history during the post-save reload', () => {
    it('show skeletons instead of the pre-save list while the reload is pending, then the fresh list', async () => {
      await renderLoaded();
      const created = price('now', 'basic', '120.00', '2026-10-12', '2026-10-12T09:00:00+00:00'); // effective today
      let resolve!: (v: unknown) => void;
      const reload = new Promise((r) => { resolve = r; });
      platformApi.mockResolvedValueOnce({ data: created }); // POST
      platformApi.mockReturnValueOnce(reload); // reload pending
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value: '120' } });
      fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: '2026-10-12' } });
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
      await screen.findByRole('status');
      // the previous basic price (99.00) must not be presented as current next to the success message
      expect(screen.getByTestId('prices-skeleton')).toBeTruthy();
      expect(screen.queryAllByText(formatRiyal('99.00'))).toHaveLength(0);
      expect(screen.queryAllByRole('row').filter((row) => row.textContent?.includes(formatRiyal('99.00')))).toHaveLength(0);
      resolve({ data: [...catalogue().data, created] });
      await waitFor(() => expect(screen.queryByTestId('prices-skeleton')).toBeNull());
      const summary = document.getElementById('prices-summary')?.closest('section') as HTMLElement;
      const basicCard = within(summary).getByText('basic').closest('[data-awj-card]') as HTMLElement;
      expect(within(basicCard).getByText(formatRiyal('120.00'))).toBeTruthy();
    });
  });

  describe('catalogue requests racing with a save', () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => { resolve = r; });
      return { promise, resolve };
    };
    const saveOne = () => {
      fireEvent.change(screen.getByLabelText(t('monthlyPrice')), { target: { value: '110' } });
      fireEvent.change(screen.getByLabelText(t('effectiveOn')), { target: { value: '2026-12-25' } });
      fireEvent.click(screen.getByRole('button', { name: t('save') }));
    };

    it('ignores an older catalogue response that arrives after the post-save reload', async () => {
      const first = deferred<{ data: unknown[] }>();
      const created = price('new', 'basic', '110.00', '2026-12-25');
      platformApi.mockReset();
      platformApi.mockReturnValueOnce(first.promise); // initial GET, still pending
      platformApi.mockResolvedValueOnce({ data: created }); // POST
      platformApi.mockResolvedValueOnce({ data: [...catalogue().data, created] }); // reload after the save
      render(<PlatformPricesPage />);
      saveOne();
      await screen.findByRole('status');
      // the confirmation also shows the amount, so look in the history table only
      const inHistory = () => screen.queryAllByRole('row').filter((row) => row.textContent?.includes(formatRiyal('110.00')));
      await waitFor(() => expect(inHistory()).toHaveLength(1));
      // the stale initial response (captured before the save) now lands last
      first.resolve(catalogue());
      await new Promise((r) => setTimeout(r, 0));
      expect(inHistory()).toHaveLength(1);
    });

    it('keeps the summary and history unavailable until a complete catalogue arrives', async () => {
      platformApi.mockReset();
      platformApi.mockRejectedValueOnce(new ApiError('temporary outage'));
      render(<PlatformPricesPage />);
      await screen.findByRole('alert');
      const reload = deferred<{ data: unknown[] }>();
      platformApi.mockResolvedValueOnce({ data: price('new', 'basic', '110.00', '2026-01-01') }); // POST
      platformApi.mockReturnValueOnce(reload.promise); // reload hangs
      saveOne();
      await screen.findByRole('status');
      // only the returned row exists locally; it must not be presented as a catalogue or a current price
      expect(screen.getByTestId('prices-skeleton')).toBeTruthy();
      expect(screen.queryAllByText(formatRiyal('110.00'))).toHaveLength(1); // the confirmation only
      expect(screen.queryByText(t('empty'))).toBeNull();
      reload.resolve({ data: [...catalogue().data, price('new', 'basic', '110.00', '2026-01-01')] });
      await waitFor(() => expect(screen.queryByTestId('prices-skeleton')).toBeNull());
      expect(screen.getAllByText(formatRiyal('199.99')).length).toBeGreaterThan(0);
    });
  });

  it('shows skeletons while loading and an empty state with no price anywhere', async () => {
    platformApi.mockResolvedValue({ data: [] });
    render(<PlatformPricesPage />);
    expect(screen.getByTestId('prices-skeleton')).toBeTruthy();
    expect(await screen.findByText(t('empty'))).toBeTruthy();
    expect(screen.getAllByText(t('noPrice'))).toHaveLength(4);
  });

  it('renders in Arabic and has every new key in both locales', async () => {
    locale = 'ar';
    render(<PlatformPricesPage />);
    await screen.findAllByText(formatRiyal('199.99'));
    expect(screen.getByText(ar.platformPrices.summaryNote)).toBeTruthy();
    // in an RTL page every date and amount in running text is isolated left-to-right
    const isolated = Array.from(document.querySelectorAll('#prices-summary ~ div bdi[dir="ltr"]')).map((n) => n.textContent);
    expect(isolated).toContain('2026-06-01');
    expect(isolated).toContain('2026-12-01');
    expect(isolated).toContain(formatRiyal('199.99'));
    const keys = ['summaryTitle', 'summaryNote', 'statusColumn', 'addedOn', 'statusCurrent', 'statusScheduled', 'statusSuperseded', 'statusUnknown', 'sinceDate', 'startsOn', 'monthlyWord', 'effectiveWord', 'noPrice', 'noCurrentPrice', 'nextScheduled', 'tiedDate', 'effectNote', 'amountHint', 'invalidAmount', 'previewTitle', 'previewScheduled', 'previewEffective', 'previewSuperseded', 'previewDuplicate', 'previewUnverified', 'previewStored', 'savedScheduled', 'savedEffective', 'savedSuperseded', 'historyNote'];
    for (const lang of [ar, en]) for (const key of keys) expect(typeof (lang.platformPrices as Record<string, unknown>)[key]).toBe('string');
  });
});
