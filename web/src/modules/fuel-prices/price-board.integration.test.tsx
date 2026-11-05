// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import type { AuthUser } from '@/lib/auth';
import { effective, history, nozzle, product, station, suggestionBlocked, suggestionOk, unset } from './__fixtures__';
import { createBackend, type Backend, type World } from './__test-backend';
import { PriceBoard } from './price-board';

const MANAGE = ['fuel_stations.view', 'fuel.sale.view', 'fuel.sale.price.manage'];
const READ_ONLY = ['fuel_stations.view', 'fuel.sale.view'];

let backend: Backend;

function seedUser(over: Partial<AuthUser> = {}) {
  const user: AuthUser = { id: 'u1', name: 'Manager', email: 'm@example.test', role: 'manager', tenant_id: 'T1', permissions: MANAGE, branch_ids: [], warehouse_ids: [], ...over };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

/** عالم اصطناعي: محطتان؛ A فيها Alpha (سعر محطة) وBeta (غير مضبوط) وGamma مسجّل بلا فوهة؛ B فيها Alpha فقط. */
function makeWorld(): World {
  return {
    stations: [station('a', 'Station A'), station('b', 'Station B')],
    products: [product('p1', 'Alpha'), product('p2', 'Beta'), product('p3', 'Gamma')],
    nozzles: [nozzle('n1', 'a', 'p1'), nozzle('n2', 'a', 'p2'), nozzle('n3', 'b', 'p1')],
    effective: {
      'station:a': [effective('a', 'p1', 218), unset('a', 'p2'), unset('a', 'p3')],
      'station:b': [effective(null, 'p1', 205, { fuel_station_id: 'b' }), unset('b', 'p2'), unset('b', 'p3')],
      tenant: [effective(null, 'p1', 205), unset(null, 'p2'), unset(null, 'p3')],
    },
    suggestions: { 'station:a': [suggestionOk('a', 'p1', 230), suggestionBlocked('a', 'p2'), suggestionBlocked('a', 'p3')], tenant: [] },
    history: {
      'station:a|p1': [[history('h2', 'a', 'p1', 218, { effective_from: '2026-10-01T09:00:00+00:00' }), history('h1', 'a', 'p1', 210, { effective_from: '2026-08-01T00:00:00+00:00', effective_until: '2026-10-01T09:00:00+00:00', entry_source: 'product_card' })]],
    },
  };
}

function connect(world: World = makeWorld()) {
  backend = createBackend(world);
  vi.stubGlobal('fetch', backend.fetchMock);
}

const renderBoard = (locale: 'en' | 'ar' = 'en') => renderIntl(<ToastProvider><PriceBoard /></ToastProvider>, locale);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const card = (name: string) => screen.getByRole('heading', { name }).closest('li') as HTMLElement;
const type = async (value: string) => {
  const input = (await screen.findByLabelText('Price per liter')) as HTMLInputElement;
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

describe('the board shows the server-resolved price, never a guess', () => {
  it('lists only products with an active nozzle at the station, with source, VAT basis and start date', async () => {
    seedUser();
    connect();
    renderBoard();
    const alpha = await screen.findByRole('heading', { name: 'Alpha' }).then((h) => h.closest('li') as HTMLElement);
    expect(within(alpha).getByText(/2\.18/)).toBeTruthy();
    expect(within(alpha).getByText('Station price')).toBeTruthy();
    expect(within(alpha).getByText(/VAT included/)).toBeTruthy();
    expect(within(alpha).getByText(/Effective since/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Gamma' })).toBeNull(); // مسجّل بلا فوهة
    expect(screen.getByText(/1 registered product\(s\) with no active nozzle/)).toBeTruthy();
  });

  it('says "Price not set" with a hint — never zero — and does not fall back to the product card', async () => {
    seedUser();
    connect();
    const { container } = renderBoard();
    await screen.findByRole('heading', { name: 'Beta' });
    const beta = card('Beta');
    expect(within(beta).getByText('Price not set')).toBeTruthy();
    expect(within(beta).getByText(/product-card price is never used automatically/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0\.00\b/);
  });

  it('labels an inherited organization price as such', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByRole('heading', { name: 'Alpha' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Choose station' }), 'b');
    const alpha = await screen.findByRole('heading', { name: 'Alpha' }).then((h) => h.closest('li') as HTMLElement);
    await waitFor(() => expect(within(alpha).getByText(/2\.05/)).toBeTruthy());
    expect(within(alpha).getByText('Organization price')).toBeTruthy();
  });

  it('shows the organization scope and its own read model', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByRole('heading', { name: 'Alpha' });
    await userEvent.click(screen.getByRole('radio', { name: 'Organization' }));
    await waitFor(() => expect(backend.callsTo('/prices/effective').some((c) => c.search.get('scope') === 'tenant_default')).toBe(true));
    const alpha = await screen.findByText(/2\.05/);
    expect(alpha).toBeTruthy();
    expect(screen.getByText(/applies to every station without its own price/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gamma' })).toBeTruthy(); // المؤسسة: كل المنتجات النشطة
  });

  it('switching station never shows the previous station\'s price while the new one loads', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    const release = backend.hold((c) => c.path.endsWith('/prices/effective') && c.search.get('station_id') === 'b');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Choose station' }), 'b');
    await waitFor(() => expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy());
    expect(screen.queryByText(/2\.18/)).toBeNull();
    release();
    await screen.findByText(/2\.05/);
  });
});

describe('time passes: scheduled changes become visible without a reload', () => {
  it('silently refreshes on focus (no skeleton) and shows the price that took effect meanwhile', async () => {
    seedUser();
    const world = makeWorld();
    connect(world);
    renderBoard();
    await screen.findByText(/2\.18/);
    world.effective['station:a'] = [effective('a', 'p1', 230, { effective_from: '2026-11-05T09:00:00+00:00' }), unset('a', 'p2'), unset('a', 'p3')];
    window.dispatchEvent(new Event('focus'));
    await screen.findByText(/2\.30/);
    expect(screen.queryByText(/2\.18/)).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('does not refresh underneath an open price sheet', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByRole('heading', { name: 'Beta' });
    await userEvent.click(within(card('Beta')).getByRole('button', { name: 'Set price' }));
    await screen.findByRole('dialog');
    const reads = backend.callsTo('/prices/effective').length;
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(backend.callsTo('/prices/effective').length).toBe(reads);
  });
});

describe('permissions and honest failure states', () => {
  it('without fuel.sale.view shows the permission state and requests no prices', async () => {
    seedUser({ permissions: ['fuel_stations.view'] });
    connect();
    renderBoard();
    expect(await screen.findByText('Not available for your permissions')).toBeTruthy();
    expect(backend.callsTo('/prices')).toHaveLength(0);
  });

  it('a read-only user sees prices but no write controls and never asks for suggestions', async () => {
    seedUser({ permissions: READ_ONLY });
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    expect(screen.queryByRole('button', { name: /Change price|Set price/ })).toBeNull();
    expect(screen.getAllByText('View only').length).toBeGreaterThan(0);
    expect(backend.callsTo('/prices/suggestions')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Price history' }).length).toBeGreaterThan(0);
  });

  it('a branch-restricted manager can manage stations but the organization price is read-only', async () => {
    seedUser({ branch_ids: ['br-1'] });
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(screen.getByRole('radio', { name: 'Organization' }));
    await screen.findByText(/2\.05/);
    expect(screen.getByText(/read-only for your account/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Change price|Set price/ })).toBeNull();
    expect(backend.callsTo('/prices/suggestions').every((c) => c.search.get('station_id') === 'a')).toBe(true);
  });

  it.each([
    [403, /Not available for your permissions/, false],
    [500, /Couldn't load prices/, true],
  ])('HTTP %i shows its own state and no number', async (status, text, retry) => {
    seedUser();
    connect();
    backend.fail((c) => c.path.endsWith('/prices/effective'), { reply: { status, body: { message: 'x' } } });
    const { container } = renderBoard();
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' }) !== null).toBe(retry);
    expect(container.textContent).not.toMatch(/\b\d+\.\d{2}\b/);
  });

  it('offline shows a connection state and retry recovers', async () => {
    seedUser();
    connect();
    backend.fail((c) => c.path.endsWith('/prices/effective'), { error: new TypeError('Failed to fetch') }, true);
    renderBoard();
    expect(await screen.findByText("Can't connect")).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/2\.18/);
  });

  it('a non-liter or malformed row is refused instead of rendered as a price', async () => {
    seedUser();
    const world = makeWorld();
    world.effective['station:a'] = [effective('a', 'p1', 218, { unit: 'pcs' }), unset('a', 'p2'), unset('a', 'p3')];
    connect(world);
    const { container } = renderBoard();
    await screen.findByText("Couldn't display the price");
    expect(container.textContent).not.toContain('2.18');
  });

  it('shows the VAT-not-set and sale blockers instead of hiding them', async () => {
    seedUser();
    const world = makeWorld();
    world.effective['station:a'] = [effective('a', 'p1', 218, { tax_mode: null, sellable: false, blockers: ['tax_mode_unset'] }), unset('a', 'p2'), unset('a', 'p3')];
    connect(world);
    renderBoard();
    await screen.findByText(/2\.18/);
    expect(screen.getAllByText(/VAT mode not set/).length).toBeGreaterThan(0);
  });
});

describe('setting a price (manual) — review, explicit confirmation, one request', () => {
  const openSet = async () => {
    await screen.findByRole('heading', { name: 'Beta' });
    await userEvent.click(within(card('Beta')).getByRole('button', { name: 'Set price' }));
  };

  it('sends exactly the reviewed values with start_now, a server-side idempotency key and no client clock', async () => {
    seedUser();
    connect();
    renderBoard();
    await openSet();
    await type('2.18');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Review before saving')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText(/2\.18/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));

    await waitFor(() => expect(backend.posts()).toHaveLength(1));
    const body = backend.posts()[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ fuel_station_id: 'a', fuel_product_id: 'p2', price_per_liter_minor: 218, start_now: true });
    expect(body.idempotency_key).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(body).not.toHaveProperty('effective_from');
    expect(body).not.toHaveProperty('supersede');
    expect(body).not.toHaveProperty('source');
    expect(await screen.findByText('Price saved')).toBeTruthy();
    await waitFor(() => expect(backend.callsTo('/prices/effective').length).toBeGreaterThan(1)); // أُعيد جلب الخادم
  });

  it('blocks zero, over-precise and empty input before any request', async () => {
    seedUser();
    connect();
    renderBoard();
    await openSet();
    const review = screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    for (const [value, message] of [['0', /greater than zero/], ['2.185', /at most two decimals/], ['abc', /valid number/]] as const) {
      await type(value);
      expect(screen.getByText(message)).toBeTruthy();
      expect(review.disabled).toBe(true);
    }
    expect(backend.posts()).toHaveLength(0);
  });

  it('a double tap on confirm sends one request', async () => {
    seedUser();
    connect();
    let release!: () => void;
    backend.setPost(async (body) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { status: 201, body: { data: history('n1', 'a', 'p2', Number(body.price_per_liter_minor)), meta: { replayed: false, superseded_price_ids: [] } } };
    });
    renderBoard();
    await openSet();
    await type('2.18');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    const confirm = screen.getByRole('button', { name: 'Confirm and save price' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole('button', { name: /Saving/ })).toBeTruthy());
    release();
    await screen.findByText('Price saved');
    expect(backend.posts()).toHaveLength(1);
  });

  it('a timeout says it cannot confirm, keeps the same idempotency key for the retry, and refreshes the board', async () => {
    seedUser();
    connect();
    backend.setPost((body) => ({ status: 200, body: { data: history('n1', 'a', 'p2', Number(body.price_per_liter_minor)), meta: { replayed: true, superseded_price_ids: [] } } }));
    backend.fail((c) => c.method === 'POST', { error: Object.assign(new Error('aborted'), { name: 'AbortError' }) }, true);
    renderBoard();
    await openSet();
    await type('2.18');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    const reads = backend.callsTo('/prices/effective').length;
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    expect(await screen.findByText(/can't confirm it saved/)).toBeTruthy();
    await waitFor(() => expect(backend.callsTo('/prices/effective').length).toBeGreaterThan(reads));
    const firstKey = (backend.posts()[0].body as Record<string, unknown>).idempotency_key;

    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    await screen.findByText('Price was already saved (not duplicated)');
    const posts = backend.posts();
    expect(posts).toHaveLength(2);
    expect((posts[1].body as Record<string, unknown>).idempotency_key).toBe(firstKey);
  });

  it('editing the inputs after a failed attempt starts a new logical attempt (new key)', async () => {
    seedUser();
    connect();
    backend.fail((c) => c.method === 'POST', { error: new TypeError('Failed to fetch') }, true);
    renderBoard();
    await openSet();
    await type('2.18');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    await screen.findByText(/connection dropped/);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await type('2.19');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    await screen.findByText('Price saved');
    const [first, second] = backend.posts();
    expect((first.body as Record<string, unknown>).idempotency_key).not.toBe((second.body as Record<string, unknown>).idempotency_key);
    expect((second.body as Record<string, unknown>).price_per_liter_minor).toBe(219);
  });

  it('a server rejection (overlap) is shown plainly and the board is refetched', async () => {
    seedUser();
    connect();
    backend.setPost(() => ({ status: 422, body: { message: 'x', reason: 'price_overlap', can_supersede: false, conflicts: [] } }));
    renderBoard();
    await openSet();
    await type('2.18');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    const reads = backend.callsTo('/prices/effective').length;
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    expect(await screen.findByText(/conflicts with this period/)).toBeTruthy();
    await waitFor(() => expect(backend.callsTo('/prices/effective').length).toBeGreaterThan(reads));
  });

  it('a scheduled start must be in the future and is sent as an absolute instant (no start_now)', async () => {
    seedUser();
    connect();
    renderBoard();
    await openSet();
    await type('2.18');
    await userEvent.click(screen.getByRole('radio', { name: 'Later' }));
    const when = screen.getByLabelText('Price start time');
    fireEvent.change(when, { target: { value: '2020-01-01T08:00' } });
    expect(screen.getByText(/at least a minute from now/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);

    const future = new Date(Date.now() + 3 * 86_400_000);
    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T08:00`;
    fireEvent.change(when, { target: { value: local } });
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    await waitFor(() => expect(backend.posts()).toHaveLength(1));
    const body = backend.posts()[0].body as Record<string, unknown>;
    expect(body.effective_from).toBe(new Date(local).toISOString());
    expect(body).not.toHaveProperty('start_now');
  });

  it('replacing the station\'s current price needs an explicit acknowledgement and sends supersede', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Change price' }));
    await type('2.30');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('The current price will be closed')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Confirm and save price' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /current price closes/ }));
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() => expect(backend.posts()).toHaveLength(1));
    expect(backend.posts()[0].body).toMatchObject({ price_per_liter_minor: 230, supersede: true, start_now: true });
  });

  it('a station price over an inherited organization price needs no replacement, only a clear note', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Choose station' }), 'b');
    await screen.findByText(/2\.05/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Set price' }));
    await type('2.40');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText(/takes precedence over the organization price \(2\.05/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    await waitFor(() => expect(backend.posts()).toHaveLength(1));
    expect(backend.posts()[0].body).not.toHaveProperty('supersede');
  });

  it('the organization scope posts a null station', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(screen.getByRole('radio', { name: 'Organization' }));
    await screen.findByRole('heading', { name: 'Gamma' });
    await userEvent.click(within(card('Gamma')).getByRole('button', { name: 'Set price' }));
    await type('2.10');
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and save price' }));
    await waitFor(() => expect(backend.posts()).toHaveLength(1));
    expect(backend.posts()[0].body).toMatchObject({ fuel_station_id: null, fuel_product_id: 'p3', price_per_liter_minor: 210 });
  });

  it('an unset VAT mode blocks the form with an explanation', async () => {
    seedUser();
    const world = makeWorld();
    world.effective['station:a'] = [effective('a', 'p1', 218), unset('a', 'p2', { tax_mode: null }), unset('a', 'p3')];
    connect(world);
    renderBoard();
    await screen.findByRole('heading', { name: 'Beta' });
    await userEvent.click(within(card('Beta')).getByRole('button', { name: 'Set price' }));
    expect(screen.getByText(/VAT mode is not set for this scope/)).toBeTruthy();
    await type('2.18');
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('suggestion from the product card — preview first, explicit confirmation to apply', () => {
  it('offers a reviewable suggestion only when the server proved it, and never saves on its own', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    expect(within(card('Alpha')).getByText(/The product card suggests 2\.30/)).toBeTruthy();
    expect(backend.posts()).toHaveLength(0);
  });

  it('requires unit and VAT acknowledgements and sends the confirmation the user saw', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Review suggestion' }));
    const input = (await screen.findByLabelText('Price per liter')) as HTMLInputElement;
    expect(input.value).toBe('2.30');
    expect(input.readOnly).toBe(true); // لا يُعدَّل الرقم المقترح هنا
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Suggested from the product card')).toBeTruthy();

    const approve = screen.getByRole('button', { name: 'Approve price' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /per liter, not per mL/ }));
    expect(approve.disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /same basis: VAT included/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /current price closes/ })); // سعر المحطة الحالي سيُغلق
    expect(approve.disabled).toBe(false);
    await userEvent.click(approve);

    await waitFor(() => expect(backend.posts()).toHaveLength(1));
    expect(backend.posts()[0].body).toMatchObject({
      price_per_liter_minor: 230, supersede: true, start_now: true,
      source: { type: 'product_card', confirm_tax_mode: 'tax_inclusive', confirm_unit: 'L' },
    });
  });

  it('a blocked suggestion says a per-liter price must be set and names the reason; nothing can be transferred', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByRole('heading', { name: 'Beta' });
    const beta = card('Beta');
    expect(within(beta).getByText('A per-liter price must be set')).toBeTruthy();
    expect(within(beta).getByText(/no explicit per-liter unit price/)).toBeTruthy();
    expect(within(beta).queryByRole('button', { name: 'Review suggestion' })).toBeNull();
  });

  it('shows no suggestion box when the suggestion equals the current scope price', async () => {
    seedUser();
    const world = makeWorld();
    world.suggestions['station:a'] = [suggestionOk('a', 'p1', 218, { matches_current: true }), suggestionBlocked('a', 'p2'), suggestionBlocked('a', 'p3')];
    connect(world);
    renderBoard();
    await screen.findByText(/2\.18/);
    expect(screen.queryByText(/The product card suggests/)).toBeNull();
  });

  it('after a rejected suggestion save the sheet never degrades to a manual save of the stale amount', async () => {
    seedUser();
    const world = makeWorld();
    connect(world);
    backend.setPost(() => {
      world.suggestions['station:a'] = [suggestionBlocked('a', 'p1', ['requires_liter_price']), suggestionBlocked('a', 'p2'), suggestionBlocked('a', 'p3')]; // البطاقة تغيّرت
      return { status: 409, body: { message: 'x', reason: 'suggestion_stale' } };
    });
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Review suggestion' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Approve price' }));

    expect(await screen.findByText(/no longer available or changed/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve price' }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Approve price' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(backend.posts()).toHaveLength(1); // لا إعادة إرسال بلا source
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a stale suggestion is refused by the server, explained, and the board refetched', async () => {
    seedUser();
    connect();
    backend.setPost(() => ({ status: 409, body: { message: 'x', reason: 'suggestion_stale', price_per_liter_minor: 240 } }));
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Review suggestion' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Review' }));
    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    const reads = backend.callsTo('/prices/suggestions').length;
    await userEvent.click(screen.getByRole('button', { name: 'Approve price' }));
    expect(await screen.findByText(/changed after you reviewed it/)).toBeTruthy();
    await waitFor(() => expect(backend.callsTo('/prices/suggestions').length).toBeGreaterThan(reads));
  });
});

describe('price history', () => {
  it('lists newest first with period, source and status, and pages on demand', async () => {
    seedUser();
    const world = makeWorld();
    world.history['station:a|p1'] = [
      [history('h3', 'a', 'p1', 218, { effective_from: '2026-10-01T09:00:00+00:00' })],
      [history('h1', 'a', 'p1', 210, { effective_from: '2026-08-01T00:00:00+00:00', effective_until: '2026-10-01T09:00:00+00:00', entry_source: 'product_card' })],
    ];
    connect(world);
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Price history' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/2\.18/);
    expect(within(dialog).getByText('open-ended', { exact: false })).toBeTruthy();
    expect(within(dialog).queryByText(/2\.10/)).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show more' }));
    await within(dialog).findByText(/2\.10/);
    expect(within(dialog).getByText('From product card')).toBeTruthy();
    expect(backend.callsTo('/fuel-stations/prices', 'GET').filter((c) => c.search.get('fuel_product_id')).map((c) => c.search.get('page'))).toEqual(['1', '2']);
  });

  it('shows an honest empty state and an error with retry — never a zero', async () => {
    seedUser();
    const world = makeWorld();
    world.history['station:a|p1'] = [[]];
    connect(world);
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Price history' }));
    expect(await screen.findByText('No price history in this scope.')).toBeTruthy();
    cleanup();

    seedUser();
    connect(makeWorld());
    backend.fail((c) => c.path === '/fuel-stations/prices' && c.search.has('fuel_product_id'), { reply: { status: 500, body: {} } }, true);
    renderBoard();
    await screen.findByText(/2\.18/);
    await userEvent.click(within(card('Alpha')).getByRole('button', { name: 'Price history' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText("Couldn't load prices");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await within(dialog).findByText(/2\.18/);
  });
});

describe('locale, digits and accessibility', () => {
  it('renders Arabic with Latin digits only and no Arabic-Indic numerals', async () => {
    seedUser();
    connect();
    const { container } = renderBoard('ar');
    await screen.findByText(/2\.18/);
    expect(container.textContent).toContain('سعر المحطة');
    expect(container.textContent).not.toMatch(/[٠-٩]/);
  });

  it.each(['en', 'ar'] as const)('the board has no axe violations (%s)', async (locale) => {
    seedUser();
    connect();
    const { container } = renderBoard(locale);
    await screen.findByText(/2\.18/);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it('the price sheet has no axe violations and a real dialog with a labelled input', async () => {
    seedUser();
    connect();
    renderBoard();
    await screen.findByRole('heading', { name: 'Beta' });
    await userEvent.click(within(card('Beta')).getByRole('button', { name: 'Set price' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Price per liter') as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('dir')).toBe('ltr');
    const results = await axe(dialog, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
