// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/opening-balance', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { product, station, tank } from '../__fixtures__';
import { ManageScreen } from '../admin/manage-screen';
import { StationOpsShell } from '../shell';
import { connectOpening, type Doc, type OpeningWorld } from './__opening-backend';
import { OpeningWizardScreen } from './opening-wizard-screen';

const apiMock = vi.mocked(api);
const VIEWER = 'u-viewer';
const ST = 'st1';

const FINANCE = ['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost', 'fuel.governance.manage', 'accounts.view', 'fuel.sale.price.manage'];
const MANAGER_NO_COST = ['fuel_stations.view', 'fuel_stations.manage', 'accounts.view', 'fuel.sale.price.manage'];
const VIEWER_ONLY = ['fuel_stations.view'];

function seedUser(permissions: string[], id = VIEWER): void {
  const user: AuthUser = { id, name: 'Fin Ance', email: 'fin@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

/** كميات المرجع في المهمة (اختبارات فقط): 30,000 / 15,555 / 31,000 لتر، سعة كل خزان 34,000 لتر. */
const CAP = 34_000_000;
function build(over: Partial<OpeningWorld> = {}): OpeningWorld {
  return {
    data: {
      stations: [station(ST, { name: 'Station A' })],
      products: [product('pa', 'Alpha'), product('pb', 'Beta'), product('pc', 'Gamma')],
      pumps: [], nozzles: [], prices: [], shifts: [],
      tanks: [tank('ta', ST, 'pa', { name: 'Tank A', capacity_milliliters: CAP }), tank('tb', ST, 'pb', { name: 'Tank B', capacity_milliliters: CAP }), tank('tc', ST, 'pc', { name: 'Tank C', capacity_milliliters: CAP }), tank('td', ST, 'pc', { name: 'Tank D', capacity_milliliters: CAP, status: 'inactive' })],
    },
    docs: [],
    accounts: [
      { id: 'a-eq', code: '3130', name: 'Opening Equity', type: 'equity', is_group: false, is_active: true },
      { id: 'a-eq2', code: '3140', name: 'Owner Capital', type: 'equity', is_group: false, is_active: true },
      { id: 'a-asset', code: '1140', name: 'Inventory', type: 'asset', is_group: false, is_active: true },
      { id: 'a-group', code: '3000', name: 'Equity Group', type: 'equity', is_group: true, is_active: true },
      { id: 'a-off', code: '3999', name: 'Retired Equity', type: 'equity', is_group: false, is_active: false },
    ],
    settings: { station: null, tenant: null },
    gateOpen: true, canSeeCost: true, poolNotEmpty: new Set(), posts: [], gets: [], viewerId: VIEWER, ...over,
  };
}

const draftDoc = (over: Partial<Doc> = {}): Doc => ({
  id: '00000000-0000-4000-8000-000000000001', number: 'FOB-2026-00001', status: 'draft', station_id: ST, opening_date: '2026-11-01', notes: 'carried', allow_zero_cost: false, total_milliliters: 30_000_000,
  total_value_minor: null, journal_entry_id: null, posted_at: null, created_by: VIEWER,
  lines: [{ id: 'l1', tank_id: 'ta', tank_name: 'Tank A', fuel_product_id: 'pa', quantity_milliliters: 30_000_000, quantity_liters: '30000', unit_cost_per_liter_minor: 218, value_minor: 6_540_000 }], ...over,
});

let world: OpeningWorld;
function connect(w: OpeningWorld) { world = w; connectOpening(w, apiMock as never); }
const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const writes = () => world.posts;

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset();
});
afterEach(() => cleanup());

async function fillQuantities(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Quantity in Tank A'), '30000');
  await user.type(screen.getByLabelText('Quantity in Tank B'), '15555');
  await user.type(screen.getByLabelText('Quantity in Tank C'), '31000');
}

async function fillCosts(user: ReturnType<typeof userEvent.setup>, account = 'a-eq') {
  await user.type(await screen.findByLabelText('Cost per liter — Alpha'), '2.18');
  await user.type(screen.getByLabelText('Cost per liter — Beta'), '2.33');
  await user.type(screen.getByLabelText('Cost per liter — Gamma'), '1.66');
  if (account) await user.selectOptions(await screen.findByLabelText('Account'), account);
}

async function toReview(user: ReturnType<typeof userEvent.setup>) {
  await fillQuantities(user);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await fillCosts(user);
  await user.click(screen.getByRole('button', { name: 'Save draft & review' }));
  await screen.findByText('Review before approval');
}

describe('availability and permissions', () => {
  it('a closed deployment gate shows "not available" and offers nothing (no wizard, no write)', async () => {
    seedUser(FINANCE);
    connect(build({ gateOpen: false }));
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByText('Not available')).toBeTruthy();
    expect(screen.queryByLabelText('Quantity in Tank A')).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it('the management screen shows the entry card only when the server supports the feature', async () => {
    seedUser(FINANCE);
    connect(build({ gateOpen: false }));
    renderOps(<ManageScreen />);
    await screen.findAllByText('Station A');
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => String(path).includes('opening-balances'))).toBe(true));
    expect(screen.queryByText('Opening fuel balance')).toBeNull();
    cleanup();
    connect(build({ gateOpen: true }));
    renderOps(<ManageScreen />);
    const link = (await screen.findByText('Opening fuel balance')).closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/fuel-stations/ops/opening-balance');
  });

  it('a user without management permission sees "no access" and sends nothing', async () => {
    seedUser(VIEWER_ONLY);
    connect(build());
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByText('No access')).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('a station that is already set up shows the approved summary, read-only, with no wizard', async () => {
    seedUser(FINANCE);
    connect(build({ docs: [draftDoc({ status: 'posted', total_value_minor: 100, posted_at: '2026-11-02T00:00:00+00:00' })] }));
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByText('Already set up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Continue|Approve/ })).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

describe('step 1 — tanks and quantities', () => {
  it('lists the active tanks with product and capacity, starts empty and never pre-fills quantities', async () => {
    seedUser(FINANCE);
    connect(build());
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByLabelText('Quantity in Tank A')).toBeTruthy();
    for (const name of ['Tank A', 'Tank B', 'Tank C']) expect((screen.getByLabelText(`Quantity in ${name}`) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Alpha/)).toBeTruthy();
    expect(screen.getAllByText(/Capacity 34,000 L/).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Quantity in Tank D') as HTMLInputElement).disabled).toBe(true); // غير نشط
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Step 1 of 3', { exact: false })).toBeTruthy();
  });

  it('validates the quantity and the capacity and blocks Continue until it is valid', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    const a = await screen.findByLabelText('Quantity in Tank A');
    await user.type(a, '34000.5');
    expect(await screen.findByText('Quantity exceeds the tank capacity.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(a);
    await user.type(a, '0');
    expect(await screen.findByText(/must be above zero/)).toBeTruthy();
    await user.clear(a);
    await user.type(a, '1.2345');
    expect(await screen.findByText(/valid number/)).toBeTruthy();
    await user.clear(a);
    await user.type(a, '34000');
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
    expect(writes()).toHaveLength(0); // لا كتابة قبل المراجعة
  });

  it('shows an honest empty state when the station has no tanks', async () => {
    seedUser(FINANCE);
    connect(build({ data: { ...build().data, tanks: [] } }));
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByText('No tanks found')).toBeTruthy();
  });
});

describe('step 2 — cost and settings', () => {
  it('asks a cost per product that is in use, lists only eligible accounts, and defaults nothing', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    for (const name of ['Alpha', 'Beta', 'Gamma']) expect((await screen.findByLabelText(`Cost per liter — ${name}`) as HTMLInputElement).value).toBe('');
    const select = screen.getByLabelText('Account') as HTMLSelectElement;
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose an account', '3130 — Opening Equity', '3140 — Owner Capital']);
    expect(screen.getByText('No account is set yet — choose one to continue.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft & review' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it('refuses a cost finer than a halala and a zero cost without the explicit approval', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const alpha = await screen.findByLabelText('Cost per liter — Alpha');
    await user.type(alpha, '2.185');
    expect(await screen.findByText('Enter a valid cost with up to 2 decimals.')).toBeTruthy();
    await user.clear(alpha);
    await user.type(alpha, '0');
    expect(await screen.findByText(/allow zero cost/)).toBeTruthy();
  });

  it('keeps notes, zero-cost and organization-default scope under "Advanced options"', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const advanced = (await screen.findByText('Advanced options')).closest('details') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(within(advanced).getByLabelText('Notes (optional)')).toBeTruthy();
    expect(within(advanced).getByLabelText(/Allow zero cost/)).toBeTruthy();
    expect(within(advanced).getByLabelText('All stations (organization default)')).toBeTruthy();
  });

  it('respects an account that is already configured (organization default) and does not rewrite it', async () => {
    seedUser(FINANCE);
    connect(build({ settings: { station: null, tenant: 'a-eq' } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await fillCosts(user, '');
    expect(await screen.findByText('Organization default')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save draft & review' }));
    await screen.findByText('Review before approval');
    expect(writes().some((p) => p.path.endsWith('/settings'))).toBe(false); // لا كتابة إعداد لحساب معيَّن سلفاً
    expect(world.settings).toEqual({ station: null, tenant: 'a-eq' });
  });

  it('a station-specific account is labelled as such and the org-scope choice is hidden', async () => {
    seedUser(FINANCE);
    connect(build({ settings: { station: 'a-eq2', tenant: 'a-eq' } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Set for this station')).toBeTruthy();
    expect(screen.queryByLabelText('All stations (organization default)')).toBeNull();
  });

  it('a configured account that is no longer eligible must be replaced', async () => {
    seedUser(FINANCE);
    connect(build({ settings: { station: 'a-asset', tenant: null } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/not eligible/)).toBeTruthy();
    await fillCosts(user, '');
    expect((screen.getByRole('button', { name: 'Save draft & review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a user who cannot browse accounts but has one configured can continue; without one they are told why', async () => {
    seedUser(FINANCE.filter((p) => p !== 'accounts.view'));
    connect(build({ settings: { station: null, tenant: 'a-eq' } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/already set/)).toBeTruthy();
    expect(screen.queryByLabelText('Account')).toBeNull();
    expect(world.gets.some((g) => g.startsWith('/accounts'))).toBe(false); // لا طلب لما لا صلاحية له
    cleanup();
    connect(build());
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/cannot browse accounts/)).toBeTruthy();
    await fillCosts(user, '');
    expect((screen.getByRole('button', { name: 'Save draft & review' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('without cost authority the costs are not asked, and the draft can still be saved (finance records them later)', async () => {
    seedUser(MANAGER_NO_COST);
    connect(build({ canSeeCost: false }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/save the draft without costs/)).toBeTruthy();
    expect(screen.queryByLabelText('Cost per liter — Alpha')).toBeNull();
    await user.selectOptions(await screen.findByLabelText('Account'), 'a-eq');
    await user.click(screen.getByRole('button', { name: 'Save draft & review' }));
    await screen.findByText('Review before approval');
    const create = writes().find((p) => p.path === '/fuel-stations/opening-balances')!;
    expect('costs' in create.body).toBe(false);
    expect(screen.getByText(/shown only to users with cost access/)).toBeTruthy();
    expect(screen.getByText(/needs finance permission/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' }) && (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('step 3 — review, preview and approval', () => {
  it('saves one draft with the exact payload, previews the server entry and writes nothing else before approval', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);

    // الكتابات حتى الآن: حفظ الحساب (المحطة) ثم مسودة واحدة — لا ترحيل.
    expect(writes().map((p) => `${p.method} ${p.path}`)).toEqual([`PUT /fuel-stations/stations/${ST}/settings`, 'POST /fuel-stations/opening-balances']);
    const settings = writes()[0];
    expect(settings.body).toEqual({ fuel_opening_balance_account_id: 'a-eq', reason: 'fuel_opening_balance_wizard' });
    const create = writes()[1].body as { idempotency_key: string; fuel_station_id: string; opening_date: string; lines: unknown; costs: unknown };
    expect(create.fuel_station_id).toBe(ST);
    expect(create.idempotency_key.length).toBeGreaterThan(8);
    expect(create.lines).toEqual([{ fuel_tank_id: 'ta', quantity_liters: '30000' }, { fuel_tank_id: 'tb', quantity_liters: '15555' }, { fuel_tank_id: 'tc', quantity_liters: '31000' }]);
    expect(create.costs).toEqual([{ fuel_product_id: 'pa', unit_cost_per_liter_minor: 218 }, { fuel_product_id: 'pb', unit_cost_per_liter_minor: 233 }, { fuel_product_id: 'pc', unit_cost_per_liter_minor: 166 }]);

    // المعاينة: الحساب المدين والدائن والمبلغ كما أعادها الخادم.
    expect(await screen.findByText('Ready to approve')).toBeTruthy();
    const journal = document.querySelector('[data-journal]') as HTMLElement;
    expect(within(journal).getByText('Debit')).toBeTruthy();
    expect(within(journal).getByText('Credit')).toBeTruthy();
    expect(journal.textContent).toContain('Inventory');
    expect(journal.textContent).toContain('Opening Equity');
    expect(journal.textContent).toMatch(/153,103\.15/); // 6,540,000 + 3,624,315(ملّي) + 5,146,000 هللة = 15,310,315 ⇒ 153,103.15 ريال
    expect(screen.getByText(/Draft FOB-2026-\d+ saved/)).toBeTruthy();
    expect(world.docs.every((d) => d.status === 'draft')).toBe(true);
  });

  it('approves exactly once after an explicit confirmation and then shows the approved summary', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approve opening balance?')).toBeTruthy();
    expect(writes().some((p) => p.path.endsWith('/post'))).toBe(false); // الحوار وحده لا يرحّل
    await user.click(screen.getByRole('button', { name: 'Approve now' }));
    expect(await screen.findByText('Opening balance approved')).toBeTruthy();
    expect(writes().filter((p) => p.path.endsWith('/post'))).toHaveLength(1);
    expect(world.docs[0].status).toBe('posted');
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull();
  });

  it('shows server blockers (stock already at the station) and cannot approve', async () => {
    seedUser(FINANCE);
    connect(build({ poolNotEmpty: new Set(['pa']) }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    expect(await screen.findByText('Cannot approve yet')).toBeTruthy();
    expect(screen.getByText(/already has stock at the station/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes().some((p) => p.path.endsWith('/post'))).toBe(false);
  });

  it('a financial refusal at approval time is shown clearly and nothing is posted', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    world.poolNotEmpty.add('pb'); // يتغيّر الوضع بين المعاينة والاعتماد
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Approve now' }));
    const alert = await screen.findByText('Approval was refused. See the points below.');
    expect(alert).toBeTruthy();
    expect(screen.getAllByText(/already has stock at the station/).length).toBeGreaterThan(0);
    expect(world.docs[0].status).toBe('draft');
    expect(screen.queryByText('Opening balance approved')).toBeNull();
  });

  it('an approver without finance permission can review but not approve', async () => {
    seedUser(['fuel_stations.view', 'fuel_stations.manage', 'accounts.view', 'products.view_cost']);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    expect(await screen.findByText(/needs finance permission/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a lost reply after approval never re-posts: the button locks until the status is read, which confirms the posting', async () => {
    seedUser(FINANCE);
    connect(build({ dropReplyAfterApply: (post) => post.path.endsWith('/post') }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Approve now' }));
    expect(await screen.findByText(/It may have gone through/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Opening balance approved')).toBeTruthy();
    expect(writes().filter((p) => p.path.endsWith('/post'))).toHaveLength(1); // لا ترحيل ثانٍ
  });

  it('if the status check shows nothing was approved, approval is available again (an explicit choice)', async () => {
    seedUser(FINANCE);
    let drop = true;
    connect(build({ dropReplyAfterApply: () => false, beforePost: (post, w) => { if (post.path.endsWith('/post') && drop) { drop = false; throw new TypeError('Failed to fetch'); } void w; } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Approve now' }));
    await user.click(await screen.findByRole('button', { name: 'Check status' }));
    expect(await screen.findByText(/nothing was approved/)).toBeTruthy();
    expect(world.docs[0].status).toBe('draft');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('a lost reply on draft creation is settled by reading the server, not by creating a second draft', async () => {
    seedUser(FINANCE);
    connect(build({ dropReplyAfterApply: (post) => post.path === '/fuel-stations/opening-balances' && post.method === 'POST' }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await fillQuantities(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await fillCosts(user);
    await user.click(screen.getByRole('button', { name: 'Save draft & review' }));
    expect(await screen.findByText(/It may have gone through/)).toBeTruthy();
    expect(world.docs).toHaveLength(1); // الخادم أنشأها فعلاً
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('The draft was saved.')).toBeTruthy();
    expect(await screen.findByText('Ready to approve')).toBeTruthy();
    expect(world.docs).toHaveLength(1);
    expect(writes().filter((p) => p.path === '/fuel-stations/opening-balances' && p.method === 'POST')).toHaveLength(1);
  });

  it('going back, changing a quantity and reviewing again updates the same draft (PUT), never a second one', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    const a = await screen.findByLabelText('Quantity in Tank A');
    await user.clear(a);
    await user.type(a, '29000');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Save draft & review' }));
    await screen.findByText('Ready to approve');
    expect(world.docs).toHaveLength(1);
    expect(writes().filter((p) => p.method === 'POST' && p.path === '/fuel-stations/opening-balances')).toHaveLength(1);
    expect(writes().filter((p) => p.method === 'PUT' && p.path.startsWith('/fuel-stations/opening-balances/'))).toHaveLength(1);
    expect(world.docs[0].lines[0].quantity_milliliters).toBe(29_000_000);
  });

  it('reviewing again without any change does not rewrite the draft', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    const before = writes().length;
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('button', { name: 'Save draft & review' }));
    await screen.findByText('Ready to approve');
    expect(writes()).toHaveLength(before);
  });
});

describe('separation of duties (distinct approver policy)', () => {
  it('the creator is told up front that someone else must approve, cannot click Approve, and nothing is posted', async () => {
    seedUser(FINANCE);
    connect(build({ distinctApprover: true }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    expect(await screen.findByText('Another person must approve')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes().some((p) => p.path.endsWith('/post'))).toBe(false);
    expect(world.docs[0].status).toBe('draft');
  });

  it('a different authorized user opens the saved draft from the same screen and approves it', async () => {
    seedUser(FINANCE, 'u-approver');
    connect(build({ distinctApprover: true, viewerId: 'u-approver', docs: [draftDoc({ created_by: 'u-creator' })], settings: { station: null, tenant: 'a-eq' } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByText(/Continuing the saved draft/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Save draft & review' }));
    await screen.findByText('Ready to approve');
    expect(screen.queryByText('Another person must approve')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Approve now' }));
    expect(await screen.findByText('Opening balance approved')).toBeTruthy();
    expect(world.docs[0].status).toBe('posted');
  });

  it('an unknown policy never blocks in the UI (the server decides) and a refusal is explained', async () => {
    seedUser(FINANCE);
    connect(build()); // المفتاح غائب من الإعدادات
    world.distinctApprover = undefined;
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    await toReview(user);
    await screen.findByText('Ready to approve');
    world.distinctApprover = true; // يُفعَّل بعد المعاينة: الخادم يرفض عند الاعتماد
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Approve now' }));
    expect(await screen.findByText(/someone other than the creator/)).toBeTruthy();
    expect(world.docs[0].status).toBe('draft');
  });
});

describe('resuming a saved draft', () => {
  it('prefills the quantities, costs and notes from the existing draft and continues it with PUT', async () => {
    seedUser(FINANCE);
    connect(build({ docs: [draftDoc()], settings: { station: null, tenant: 'a-eq' } }));
    const user = userEvent.setup();
    renderOps(<OpeningWizardScreen />);
    expect(await screen.findByText(/Continuing the saved draft FOB-2026-00001/)).toBeTruthy();
    expect((screen.getByLabelText('Quantity in Tank A') as HTMLInputElement).value).toBe('30000');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByLabelText('Cost per liter — Alpha') as HTMLInputElement).value).toBe('2.18');
    await user.click(screen.getByRole('button', { name: 'Save draft & review' }));
    await screen.findByText('Review before approval');
    expect(writes().map((p) => p.method)).toEqual(['PUT']);
    expect(world.docs).toHaveLength(1);
  });
});

describe('Arabic RTL and accessibility', () => {
  it('renders in Arabic with ASCII digits and no accessibility violations on every step', async () => {
    seedUser(FINANCE);
    connect(build());
    const user = userEvent.setup();
    const { container } = renderOps(<OpeningWizardScreen />, 'ar');
    await user.type(await screen.findByLabelText('الكمية في Tank A'), '30000');
    expect(screen.getByText('الخطوة 1 من 3', { exact: false })).toBeTruthy();
    expect(container.textContent).not.toMatch(/[٠-٩]/);
    const rules = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };
    expect((await axe(container, rules)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'متابعة' }));
    await screen.findByLabelText('تكلفة اللتر — Alpha');
    expect((await axe(container, rules)).violations).toEqual([]);
    await user.type(screen.getByLabelText('تكلفة اللتر — Alpha'), '2.18');
    await user.selectOptions(screen.getByLabelText('الحساب'), 'a-eq');
    await user.click(screen.getByRole('button', { name: 'احفظ المسودة وراجع' }));
    await screen.findByText('المراجعة قبل الاعتماد');
    expect(document.body.textContent).toContain('مدين');
    expect(document.body.textContent).toContain('دائن');
    expect((await axe(container, rules)).violations).toEqual([]);
  });
});
