// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { LINK_ID, OWNER_ID, PARTNER_A, PARTNER_B, TANKER_ID, link, owner, page, tanker } from './__fixtures__';

type Opts = { method?: string; body?: unknown };
const state = vi.hoisted(() => ({
  permissions: ['*'] as string[],
  owner: undefined as unknown,
  tankers: undefined as unknown,
  links: undefined as unknown,
  customers: undefined as unknown,
  write: undefined as undefined | ((path: string, opts: Opts) => unknown),
}));
const toast = vi.hoisted(() => vi.fn());
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body: unknown }>);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toast, error: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: Opts = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ path, method, body: opts.body });
    let result: unknown;
    if (method !== 'GET' && state.write) result = state.write(path, opts);
    else if (path.startsWith('/partners')) result = state.customers;
    else if (path.includes('/company-links')) result = state.links;
    else if (path.startsWith('/fuel-stations/tankers')) result = state.tankers;
    else result = state.owner;
    if (result instanceof Error) throw result;
    return result;
  }),
}));

import { ApiError } from '@/lib/api';
import { OwnerDetailScreen } from './owner-detail-screen';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankers;
const posts = () => calls.filter((c) => c.method !== 'GET');
/** زرّ منتقي الشركة (اسمه يأتي من تسمية الحقل «الشركة» لا من نص الخيار الافتراضي). */
const partnerTrigger = (dialog: HTMLElement) => dialog.querySelector('#tanker-link-partner') as HTMLButtonElement;
const customers = () => ({ data: [{ id: PARTNER_A, name: 'شركة أ', code: 'C-A', is_active: true }, { id: PARTNER_B, name: 'شركة ب', code: null, is_active: true }] });

beforeEach(() => {
  calls.length = 0;
  state.permissions = ['*'];
  state.owner = { data: owner() };
  state.tankers = page([tanker()]);
  state.links = page([link()]);
  state.customers = customers();
  state.write = undefined;
});
afterEach(() => { cleanup(); toast.mockReset(); });

async function ready() {
  await screen.findAllByText('ABC 1234');
  await screen.findAllByText('شركة أ');
}

describe.each(['ar', 'en'] as const)('OwnerDetailScreen (%s)', (locale) => {
  it('shows the profile, the tankers (capacity in liters, never raw milliliters) and the dated company links', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    expect(screen.getAllByText('مالك تجريبي').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0500000000').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ملاحظة داخلية').length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/30[,٬]?000/);
    expect(document.body.textContent).not.toContain('30000000');
    expect(screen.getAllByText(T(locale).phase.active).length).toBeGreaterThan(0);
    expect(calls.map((c) => c.path).sort()).toEqual([
      `/fuel-stations/tanker-owners/${OWNER_ID}`,
      `/fuel-stations/tanker-owners/${OWNER_ID}/company-links`,
      `/fuel-stations/tankers?owner_id=${OWNER_ID}`,
    ].sort());
  });

  it('answers a 404 on the record with the unified not-found state (foreign tenant, missing, or feature closed — never distinguished)', async () => {
    state.owner = new ApiError(404, 'Not Found', {});
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    expect(await screen.findByText(T(locale).states.notFoundTitle)).toBeTruthy();
    // لا نداء للأقسام التابعة (صهاريج/ربط) لصاحب لم يُحمَّل: الطلب الوحيد هو قراءة السجل.
    expect(calls.map((c) => c.path)).toEqual([`/fuel-stations/tanker-owners/${OWNER_ID}`]);
  });

  it('treats a malformed id as not found without any request', async () => {
    renderIntl(<OwnerDetailScreen ownerId="not-a-uuid" />, locale);
    expect(await screen.findByText(T(locale).states.notFoundTitle)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('refuses without the view permission and sends nothing', async () => {
    state.permissions = ['fuel_stations.view'];
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    expect(await screen.findByText(T(locale).states.forbiddenTitle)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('view-only: contact details are replaced by an explanation, and every write control is disabled and explained', async () => {
    state.permissions = ['fuel.tanker.view'];
    state.owner = { data: owner({ phone: undefined, notes: undefined }) };
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    expect(screen.getAllByText(T(locale).detail.managerOnly)).toHaveLength(2);
    expect(screen.queryByText('0500000000')).toBeNull();
    const writeButtons = [
      screen.getByRole('button', { name: T(locale).owner.editTitle }),
      screen.getByRole('button', { name: T(locale).tanker.create }),
      screen.getByRole('button', { name: T(locale).link.create }),
    ] as HTMLButtonElement[];
    for (const button of writeButtons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('fuel.tanker.manage');
    }
    expect(screen.queryByRole('button', { name: T(locale).link.end })).toBeNull();
    expect(screen.getAllByRole('button', { name: /ABC 1234/ }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it('an inactive owner cannot receive tankers or links (server rule) and the screen says why', async () => {
    state.owner = { data: owner({ status: 'inactive' }) };
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    expect((screen.getByRole('button', { name: T(locale).tanker.create }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: T(locale).link.create }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(T(locale).tanker.ownerInactive)).toBeTruthy();
    expect(screen.getByText(T(locale).link.ownerInactive)).toBeTruthy();
  });

  it('empty sections explain themselves', async () => {
    state.tankers = page([]);
    state.links = page([]);
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    expect(await screen.findByText(T(locale).tanker.empty)).toBeTruthy();
    expect(await screen.findByText(T(locale).link.empty)).toBeTruthy();
  });

  it('a failing section shows its own error with retry and does not take the page down', async () => {
    const original = state.tankers;
    state.tankers = new ApiError(500, 'boom', {});
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    expect(await screen.findByText(T(locale).tanker.loadFailed)).toBeTruthy();
    expect(screen.getAllByText('شركة أ').length).toBeGreaterThan(0);
    state.tankers = original;
    fireEvent.click(screen.getAllByRole('button', { name: TEST_MESSAGES[locale].nebrax.retry })[0]);
    expect((await screen.findAllByText('ABC 1234')).length).toBeGreaterThan(0);
  });

  it('shows an unspecified tanker capacity as «Not specified» — in the desktop table AND the mobile cards — never as 0', async () => {
    state.tankers = page([tanker({ capacity_milliliters: null })]);
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    // الجدول وبطاقات الجوال كلاهما يُعرضان في jsdom (CSS يختار أحدهما) — يجب أن يظهر النص في الموضعين
    expect(screen.getAllByText(T(locale).tanker.capacityUnspecified).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryAllByText(/^0\s*(L|لتر)$/)).toHaveLength(0);
  });

  it('keeps a real capacity formatted in liters next to an unspecified one', async () => {
    state.tankers = page([tanker({ capacity_milliliters: null }), tanker({ id: '22222222-2222-4222-8222-222222222299', plate_number: 'DEF 5678', capacity_milliliters: 12500 })]);
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await screen.findAllByText('DEF 5678');
    expect(screen.getAllByText(T(locale).tanker.capacityUnspecified).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/^12\.5\s*(L|لتر)$/).length).toBeGreaterThanOrEqual(2);
  });

  it('adds a tanker: liters become an integer milliliter capacity, the owner id is sent once, nothing else leaks', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    state.write = () => ({ data: tanker({ id: '77777777-7777-4777-8777-777777777777', plate_number: 'XYZ 99' }) });
    fireEvent.click(screen.getByRole('button', { name: T(locale).tanker.create }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#tanker-plate')!, { target: { value: ' XYZ 99 ' } });
    fireEvent.change(dialog.querySelector('#tanker-capacity')!, { target: { value: '12.5' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ path: '/fuel-stations/tankers', method: 'POST' });
    expect(posts()[0].body).toEqual({ fuel_tanker_owner_id: OWNER_ID, plate_number: 'XYZ 99', plate_country: null, capacity_milliliters: 12500, notes: null, status: 'active' });
    await waitFor(() => expect(toast).toHaveBeenCalled());
  });

  it('rejects an invalid capacity locally, and shows the server duplicate-plate error on the field', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: T(locale).tanker.create }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#tanker-plate')!, { target: { value: 'ABC 1234' } });
    fireEvent.change(dialog.querySelector('#tanker-capacity')!, { target: { value: 'abc' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText(T(locale).errors.invalid_capacity)).toBeTruthy();
    expect(posts()).toHaveLength(0);

    state.write = () => new ApiError(422, 'invalid', { errors: { plate_number: ['رقم اللوحة مسجَّل مسبقاً لصهريج آخر.'] } });
    fireEvent.change(dialog.querySelector('#tanker-capacity')!, { target: { value: '' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText('رقم اللوحة مسجَّل مسبقاً لصهريج آخر.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('edits a tanker sending only changed fields and never the owner; a no-op edit sends nothing', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: /ABC 1234/ })[0]);
    let dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toHaveLength(0);

    state.write = () => ({ data: tanker({ status: 'suspended' }) });
    fireEvent.click(screen.getAllByRole('button', { name: /ABC 1234/ })[0]);
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'suspended' } });
    fireEvent.change(dialog.querySelector('#tanker-reason')!, { target: { value: 'صيانة' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ path: `/fuel-stations/tankers/${TANKER_ID}`, method: 'PUT', body: { status: 'suspended', reason: 'صيانة' } });
    expect(posts()[0].body).not.toHaveProperty('fuel_tanker_owner_id');
  });

  it('links a company: picks from official customers (already-linked ones are disabled with a reason) and sends only the chosen ids/dates', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    state.write = () => ({ data: link({ id: '88888888-8888-4888-8888-888888888888', partner_id: PARTNER_B, partner: { id: PARTNER_B, name: 'شركة ب' } }) });
    fireEvent.click(screen.getByRole('button', { name: T(locale).link.create }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(partnerTrigger(dialog).disabled).toBe(false));
    expect(calls.some((c) => c.path.startsWith('/partners?') && c.path.includes('type=customer'))).toBe(true);

    fireEvent.click(partnerTrigger(dialog));
    const options = await screen.findAllByRole('option');
    const linked = options.find((o) => o.textContent?.includes('شركة أ'))!;
    expect(linked.getAttribute('aria-disabled')).toBe('true');
    expect(linked.textContent).toContain(T(locale).link.alreadyLinked);
    fireEvent.click(options.find((o) => o.textContent?.includes('شركة ب'))!);

    fireEvent.change(dialog.querySelector('#tanker-link-from')!, { target: { value: '2026-02-01' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ path: `/fuel-stations/tanker-owners/${OWNER_ID}/company-links`, method: 'POST', body: { partner_id: PARTNER_B, valid_from: '2026-02-01' } });
    expect(Object.keys(posts()[0].body as object)).not.toContain('tenant_id');
  });

  it('requires a company, blocks an end before the start, and shows the server overlap error', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: T(locale).link.create }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(partnerTrigger(dialog).disabled).toBe(false));
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText(T(locale).errors.required)).toBeTruthy();
    expect(posts()).toHaveLength(0);

    fireEvent.click(partnerTrigger(dialog));
    fireEvent.click((await screen.findAllByRole('option')).find((o) => o.textContent?.includes('شركة ب'))!);
    fireEvent.change(dialog.querySelector('#tanker-link-from')!, { target: { value: '2026-03-01' } });
    fireEvent.change(dialog.querySelector('#tanker-link-to')!, { target: { value: '2026-02-01' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText(T(locale).errors.end_before_start)).toBeTruthy();
    expect(posts()).toHaveLength(0);

    fireEvent.change(dialog.querySelector('#tanker-link-to')!, { target: { value: '' } });
    state.write = () => new ApiError(422, 'invalid', { errors: { partner_id: ['هذه الشركة مرتبطة بصاحب الصهريج نفسه في فترة متداخلة.'] } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText('هذه الشركة مرتبطة بصاحب الصهريج نفسه في فترة متداخلة.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a retry when the customer lookup fails and does not enable submission meanwhile', async () => {
    state.customers = new ApiError(500, 'boom', {});
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: T(locale).link.create }));
    expect(await screen.findByText(T(locale).link.lookupFailed)).toBeTruthy();
    state.customers = customers();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: T(locale).common.retry }));
    await waitFor(() => expect(screen.queryByText(T(locale).link.lookupFailed)).toBeNull());
  });

  it('ends only an open link: a warning about finality, optional date/reason, and ended links offer no action', async () => {
    state.links = page([link(), link({ id: '99999999-9999-4999-8999-999999999999', partner: { id: PARTNER_B, name: 'شركة ب' }, partner_id: PARTNER_B, valid_to: '2026-01-31', is_active: false, end_reason: 'انتهى' })]);
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await screen.findAllByText('شركة ب');
    expect(screen.getAllByText(T(locale).phase.ended).length).toBeGreaterThan(0);
    const endButtons = screen.getAllByRole('button', { name: T(locale).link.endAria.replace('{name}', 'شركة أ') });
    expect(endButtons.length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: T(locale).link.endAria.replace('{name}', 'شركة ب') })).toHaveLength(0);

    state.write = () => ({ data: link({ valid_to: '2026-03-31', is_active: false }) });
    fireEvent.click(endButtons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(T(locale).link.endWarning)).toBeTruthy();
    fireEvent.change(dialog.querySelector('#tanker-link-end-date')!, { target: { value: '2026-03-31' } });
    fireEvent.change(dialog.querySelector('#tanker-link-end-reason')!, { target: { value: 'انتهى العقد' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ path: `/fuel-stations/tanker-owners/${OWNER_ID}/company-links/${LINK_ID}/end`, method: 'POST', body: { valid_to: '2026-03-31', reason: 'انتهى العقد' } });
  });

  it('blocks an end date before the link start without calling the server', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: T(locale).link.endAria.replace('{name}', 'شركة أ') })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#tanker-link-end-date')!, { target: { value: '2025-12-31' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText(T(locale).errors.end_before_start)).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it('edits the owner profile sending only changes, updates the header in place, and a forbidden save is explained in the dialog', async () => {
    renderIntl(<OwnerDetailScreen ownerId={OWNER_ID} />, locale);
    await ready();
    state.write = () => new ApiError(403, 'Forbidden', {});
    fireEvent.click(screen.getByRole('button', { name: T(locale).owner.editTitle }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('#tanker-owner-name')!, { target: { value: 'اسم جديد' } });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await screen.findByText(T(locale).errors.forbidden)).toBeTruthy();

    state.write = () => ({ data: owner({ name: 'اسم جديد' }) });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const put = posts().at(-1)!;
    expect(put).toMatchObject({ path: `/fuel-stations/tanker-owners/${OWNER_ID}`, method: 'PUT', body: { name: 'اسم جديد' } });
    expect(screen.getAllByText('اسم جديد').length).toBeGreaterThan(0);
  });
});
