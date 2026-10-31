import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { countByStatus, filterQuotes, loadQuotesOverview, quotePath, type Quote } from './api';

const quote = (id: string, status: string, partner = 'c1', number = `Q-${id}`): Quote => ({
  id, number, partner_id: partner, status, quote_date: '2026-01-01', valid_until: null, total: '10.00',
});

describe('quotations api', () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it('reads quotes and, with permission, customer names — only the existing endpoints', async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(path === '/quotes' ? { data: [quote('1', 'draft')] } : { data: [{ id: 'c1', name: 'Al Noor' }] }),
    );
    const result = await loadQuotesOverview(true);
    expect(apiMock.mock.calls.map((call) => call[0]).sort()).toEqual(['/partners?type=customer', '/quotes']);
    expect(result.customers).toEqual({ c1: 'Al Noor' });
  });

  it('does not request customers without the permission', async () => {
    apiMock.mockResolvedValue({ data: [quote('1', 'draft')] });
    const result = await loadQuotesOverview(false);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/quotes');
    expect(result.customers).toBeNull();
  });

  it('keeps the quotes when only the customer lookup fails', async () => {
    apiMock.mockImplementation((path: string) => (path === '/quotes' ? Promise.resolve({ data: [quote('1', 'sent')] }) : Promise.reject(new Error('403'))));
    const result = await loadQuotesOverview(true);
    expect(result.quotes).toHaveLength(1);
    expect(result.customers).toBeNull();
  });

  it('fails when the quotes themselves cannot be read', async () => {
    apiMock.mockImplementation(() => Promise.reject(Object.assign(new Error('x'), { status: 500 })));
    await expect(loadQuotesOverview(false)).rejects.toBeTruthy();
  });

  it('counts by status and filters the loaded list', () => {
    const quotes = [quote('1', 'draft'), quote('2', 'sent', 'c2'), quote('3', 'sent', 'c1', 'Q-777')];
    expect(countByStatus(quotes)).toEqual({ draft: 1, sent: 2 });
    const customers = { c1: 'Al Noor', c2: 'Beta' };
    expect(filterQuotes(quotes, { status: 'sent', search: '', customers }).map((q) => q.id)).toEqual(['2', '3']);
    expect(filterQuotes(quotes, { status: '', search: 'noor', customers }).map((q) => q.id)).toEqual(['1', '3']);
    expect(filterQuotes(quotes, { status: '', search: '777', customers: null }).map((q) => q.id)).toEqual(['3']);
  });

  it('builds the deep link into the existing quote screen', () => {
    expect(quotePath('a b')).toBe('/quotes/a%20b');
  });
});
