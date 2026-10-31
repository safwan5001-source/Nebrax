import { api } from '@/lib/api';

/**
 * Quotations are AWJ sales documents (`GET /quotes`, branch-scoped like invoices). They are NOT scoped to a sales
 * channel — there is no channel column — so this section is a read-only window onto the existing workflow, with
 * deep links for create / issue / revise / convert (never re-implemented here).
 */

export type Quote = {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  quote_date: string | null;
  valid_until: string | null;
  /** Riyal string as returned by the API (display only). */
  total: string;
  converted_invoice_id?: string | null;
};

export type QuotesOverview = {
  quotes: Quote[];
  /** `null` = customer names could not be read (no permission / failure): rows show a dash, never a guessed name. */
  customers: Record<string, string> | null;
};

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'converted'] as const;

export async function fetchQuotes(): Promise<Quote[]> {
  const response = await api<{ data: Quote[] }>('/quotes');
  return Array.isArray(response.data) ? response.data : [];
}

export async function fetchCustomerNames(): Promise<Record<string, string>> {
  const response = await api<{ data: { id: string; name: string }[] }>('/partners?type=customer');
  return Object.fromEntries((Array.isArray(response.data) ? response.data : []).map((partner) => [partner.id, partner.name]));
}

/** Quotes are required; customer names are best-effort and only requested when the viewer may read parties. */
export async function loadQuotesOverview(canReadCustomers: boolean): Promise<QuotesOverview> {
  const [quotes, customers] = await Promise.all([
    fetchQuotes(),
    canReadCustomers ? fetchCustomerNames().catch(() => null) : Promise.resolve(null),
  ]);
  return { quotes, customers };
}

export function countByStatus(quotes: Quote[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const quote of quotes) counts[quote.status] = (counts[quote.status] ?? 0) + 1;
  return counts;
}

/** Client-side narrowing of the already-loaded list (the endpoint has no server filters). */
export function filterQuotes(quotes: Quote[], { status, search, customers }: { status: string; search: string; customers: Record<string, string> | null }): Quote[] {
  const needle = search.trim().toLocaleLowerCase();
  return quotes.filter((quote) => {
    if (status !== '' && quote.status !== status) return false;
    if (needle === '') return true;
    const haystack = [quote.number, customers?.[quote.partner_id] ?? ''].join(' ').toLocaleLowerCase();
    return haystack.includes(needle);
  });
}

export const QUOTES_NEW_PATH = '/quotes/new';
export const quotePath = (id: string): string => `/quotes/${encodeURIComponent(id)}`;
