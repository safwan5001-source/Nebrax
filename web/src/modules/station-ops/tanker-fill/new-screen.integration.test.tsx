// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/tanker-fills/new', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { StationOpsShell } from '../shell';
import { OWNER_A, OWNER_B, ST, TANKER_A, UID, buildWorld, connect, type World } from './__tanker-backend';
import { TankerFillNewScreen } from './new-screen';

const apiMock = vi.mocked(api);
const RECORDER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record'];
let world: World;

function seedUser(permissions: string[], id = 'u-worker') {
  const user: AuthUser = { id, name: 'Station Worker', email: 'w@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function setup(over: Partial<World> = {}, permissions: string[] = RECORDER, id = 'u-worker') {
  seedUser(permissions, id);
  world = buildWorld(over);
  connect(world, apiMock as never);
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear();
  sessionStorage.clear();
  apiMock.mockReset();
});
afterEach(() => cleanup());

const mount = (locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell><TankerFillNewScreen /></StationOpsShell>, locale);
const posts = () => world.posts;
const btn = (name: string | RegExp) => screen.getByRole('button', { name });
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(btn('Next'));

async function pickOwner(user: ReturnType<typeof userEvent.setup>, name = /Askar/) {
  await user.click(await screen.findByRole('radio', { name }));
}

async function toQuantityStep(user: ReturnType<typeof userEvent.setup>, opts: { tanker?: boolean } = {}) {
  await pickOwner(user);
  if (opts.tanker === false) await user.click(await screen.findByRole('radio', { name: /Without a tanker/ }));
  await waitFor(() => expect((btn('Next') as HTMLButtonElement).disabled).toBe(false));
  await next(user);
  await user.click(await screen.findByRole('radio', { name: /Nozzle 1/ }));
  await next(user);
  await screen.findByLabelText(/Quantity/);
}

async function fillQuantity(user: ReturnType<typeof userEvent.setup>, liters: string, voucher: string) {
  const quantity = screen.getByLabelText(/^Quantity/);
  await user.clear(quantity);
  if (liters) await user.type(quantity, liters);
  const voucherInput = screen.getByLabelText('Paper voucher no.');
  await user.clear(voucherInput);
  if (voucher) await user.type(voucherInput, voucher);
}

async function toReview(user: ReturnType<typeof userEvent.setup>, liters = '2000', voucher = '04052') {
  await toQuantityStep(user);
  await fillQuantity(user, liters, voucher);
  await next(user);
  await screen.findByText('Review before saving');
}

describe('recording a tanker fill (happy path)', () => {
  it('walks owner → nozzle → quantity → review → saved, sending exactly the accepted fields', async () => {
    setup();
    const user = userEvent.setup();
    mount();

    // الصاحب: الصهريج الوحيد يُختار تلقائياً، والوردية الحالية تُعرض ولا تُختار.
    expect(await screen.findByText('FSH-0001')).toBeTruthy();
    await pickOwner(user);
    const tanker = await screen.findByRole('radio', { name: /ABJ 1234/ });
    await waitFor(() => expect(tanker.getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText('Choosing the tanker is optional; the fill is recorded on the owner’s account either way.')).toBeTruthy();
    await next(user);

    // الفوهة: غير المسموحة والمعطّلة معطّلة بسببها، والمنتج والخزان للقراءة فقط.
    const allowed = await screen.findByRole('radio', { name: /Nozzle 1/ });
    const restricted = screen.getByRole('radio', { name: /Nozzle 2/ }) as HTMLButtonElement;
    const inactive = screen.getByRole('radio', { name: /Nozzle 3/ }) as HTMLButtonElement;
    expect(restricted.disabled).toBe(true);
    expect(restricted.textContent).toContain('Tanker fills not allowed');
    expect(inactive.disabled).toBe(true);
    expect(inactive.textContent).toContain('Nozzle is not active');
    await user.click(allowed);
    const derived = document.querySelector('[data-derived]') as HTMLElement;
    expect(within(derived).getByText('Diesel')).toBeTruthy();
    expect(within(derived).getByText('Tank Diesel')).toBeTruthy();
    expect(derived.querySelector('input')).toBeNull();
    await next(user);

    // الكمية والسند: الأرقام العربية تُطبَّع والأصفار تبقى.
    await fillQuantity(user, '٢٠٠٠', '٠٤٠٥٢');
    expect(screen.getByText('It will be saved as: 04052')).toBeTruthy();
    await next(user);

    // المراجعة قبل الحفظ + تنبيه عدم الخصم.
    await screen.findByText('Review before saving');
    expect((document.querySelector('[data-review-liters]') as HTMLElement).textContent).toContain('2000.000');
    expect((document.querySelector('[data-review-voucher]') as HTMLElement).textContent).toBe('04052');
    expect(document.querySelector('[data-no-stock-note]')?.textContent).toContain('does not deduct fuel from station stock');
    expect(posts()).toHaveLength(0); // لا شيء يُرسل قبل «حفظ»

    await user.click(btn('Save fill'));
    await screen.findByText('Fill recorded');
    expect(posts()).toHaveLength(1);
    const sent = posts()[0];
    expect(Object.keys(sent).sort()).toEqual(['fuel_nozzle_id', 'fuel_shift_id', 'fuel_station_id', 'fuel_tanker_id', 'fuel_tanker_owner_id', 'idempotency_key', 'quantity_milliliters', 'voucher_number']);
    expect(sent).toMatchObject({ fuel_station_id: ST, fuel_nozzle_id: 'nz1', fuel_tanker_owner_id: OWNER_A, fuel_tanker_id: TANKER_A, fuel_shift_id: 'sh1', voucher_number: '04052', quantity_milliliters: 2_000_000 });
    expect(String(sent.idempotency_key)).toMatch(/^awj-ops-/);

    // النجاح: رقم السند الإلكتروني، والحالة «بانتظار الدمج المخزني»، وتنبيه عدم الخصم.
    expect((document.querySelector('[data-fill-number]') as HTMLElement).textContent).toBe('FTF-2027-00001');
    expect(within(document.querySelector('[data-fill-success]') as HTMLElement).getByText('Awaiting stock integration')).toBeTruthy();
    expect(document.querySelector('[data-no-stock-note]')).not.toBeNull();
  });

  it('renders in Arabic with the same flow and the no-deduction notice', async () => {
    setup();
    const user = userEvent.setup();
    mount('ar');
    await user.click(await screen.findByRole('radio', { name: /Askar/ }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'التالي' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'التالي' }));
    await user.click(await screen.findByRole('radio', { name: /فوهة 1/ }));
    await user.click(screen.getByRole('button', { name: 'التالي' }));
    await user.type(await screen.findByLabelText(/^الكمية/), '١٢٫٥');
    await user.type(screen.getByLabelText('رقم السند الورقي'), '٧٧');
    await user.click(screen.getByRole('button', { name: 'التالي' }));
    await screen.findByText('راجع قبل الحفظ');
    expect(document.querySelector('[data-no-stock-note]')?.textContent).toMatch(/لا يخصم الوقود/);
    await user.click(screen.getByRole('button', { name: 'حفظ التعبئة' }));
    await screen.findByText('تم تسجيل التعبئة');
    expect(posts()[0]).toMatchObject({ quantity_milliliters: 12_500, voucher_number: '77' });
  });

  it('records without a tanker when the policy is optional (the owner account carries it)', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user, { tanker: false });
    await fillQuantity(user, '100', '1');
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Save fill' }));
    await screen.findByText('Fill recorded');
    expect('fuel_tanker_id' in posts()[0]).toBe(false);
  });
});

describe('blocking states send nothing', () => {
  it('no open shift: the wizard does not start and nothing is requested for owners or posted', async () => {
    setup({ openShift: null });
    mount();
    expect(await screen.findByText('No open shift')).toBeTruthy();
    expect(document.querySelector('[data-tanker-wizard]')).toBeNull();
    expect(world.gets.some((url) => url.includes('tanker-owners'))).toBe(false);
    expect(posts()).toHaveLength(0);
  });

  it('without the record permission: a refusal and no tanker request at all', async () => {
    setup({}, ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.fill.view']);
    mount();
    expect(await screen.findByText('You cannot record tanker fills')).toBeTruthy();
    // لا طلب لأصحاب الصهاريج/الصهاريج ولا كتابة؛ مسبار السندات (قراءة بصلاحية العرض) مسموح.
    expect(world.gets.filter((url) => /tanker-owners|\/tankers/.test(url))).toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });

  it('without the owners-read permission the wizard cannot start either (the server would refuse)', async () => {
    setup({}, ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record']);
    mount();
    expect(await screen.findByText('You cannot record tanker fills')).toBeTruthy();
  });

  it('gate closed on the server (404): "Feature not enabled", no wizard', async () => {
    setup({ gateClosed: true });
    mount();
    expect(await screen.findByText('Feature not enabled')).toBeTruthy();
    expect(document.querySelector('[data-tanker-wizard]')).toBeNull();
  });

  it('no allowed nozzle at the station: an explicit empty state and no way forward', async () => {
    setup({ nozzles: [] });
    const user = userEvent.setup();
    mount();
    await pickOwner(user);
    await waitFor(() => expect((btn('Next') as HTMLButtonElement).disabled).toBe(false));
    await next(user);
    expect(await screen.findByText('No allowed nozzle')).toBeTruthy();
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('only ineligible nozzles: none can be chosen and Next stays disabled', async () => {
    setup({ nozzles: [] });
    setup({ nozzles: [] });
    const user = userEvent.setup();
    mount();
    await pickOwner(user);
    await waitFor(() => expect((btn('Next') as HTMLButtonElement).disabled).toBe(false));
    await next(user);
    await screen.findByText('No allowed nozzle');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});

describe('policy and validation (client-side guidance; the server decides)', () => {
  it('required tanker: Next is blocked until a tanker is chosen and no "without tanker" option exists', async () => {
    setup({ settings: { tanker_selection_required: true, tanker_capacity_overrun_policy: 'allow_with_confirmation' }, tankers: [
      { id: TANKER_A, fuel_tanker_owner_id: OWNER_A, plate_number: 'ABJ 1234', capacity_milliliters: 5_000_000, status: 'active' },
      { id: UID(202), fuel_tanker_owner_id: OWNER_A, plate_number: 'XYZ 9', capacity_milliliters: null, status: 'active' },
    ] });
    const user = userEvent.setup();
    mount();
    await pickOwner(user);
    await screen.findByRole('radio', { name: /XYZ 9/ });
    expect(screen.getByText('Choosing the tanker is required at this station.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Without a tanker/ })).toBeNull();
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: /XYZ 9/ }));
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('required tanker but the owner has none registered: never blocked (approved rule)', async () => {
    setup({ settings: { tanker_selection_required: true }, tankers: [] });
    const user = userEvent.setup();
    mount();
    await pickOwner(user);
    expect(await screen.findByText('This owner has no registered tankers. The fill is recorded on their account.')).toBeTruthy();
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ['', 'Enter the quantity in litres.', false], ['0', 'The quantity must be greater than zero.', true], ['-5', 'The quantity cannot be negative.', true], ['abc', 'The quantity is not valid. Use digits only, with a dot for the fraction.', true],
    ['1.2345', 'At most three decimals.', true],
  ])('quantity %j blocks the step', async (input, _message, shows) => {
    setup();
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user);
    await fillQuantity(user, input, '04052');
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
    if (shows) expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(posts()).toHaveLength(0);
  });

  it('an empty voucher blocks the step', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user);
    await fillQuantity(user, '100', '');
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('capacity overrun (default policy): needs an explicit confirmation, then it is sent', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user);
    await fillQuantity(user, '6000', '04052');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('exceeds tanker ABJ 1234 capacity by 1000.000 L');
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'I confirm the quantity is correct' }));
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(false);
    await next(user);
    await screen.findByText('Review before saving');
    expect(document.querySelector('[data-review-overrun]')?.textContent).toContain('1000.000');
    await user.click(btn('Save fill'));
    await screen.findByText('Fill recorded');
    expect(posts()[0].confirm_capacity_overrun).toBe(true);
  });

  it('changing the quantity clears a stale confirmation', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user);
    await fillQuantity(user, '6000', '04052');
    await user.click(await screen.findByRole('checkbox', { name: 'I confirm the quantity is correct' }));
    await user.type(screen.getByLabelText(/^Quantity/), '1');
    expect((screen.getByRole('checkbox', { name: 'I confirm the quantity is correct' }) as HTMLInputElement).checked).toBe(false);
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('capacity policy "block": confirmation cannot unlock the step', async () => {
    setup({ settings: { tanker_selection_required: false, tanker_capacity_overrun_policy: 'block' } });
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user);
    await fillQuantity(user, '6000', '04052');
    expect(await screen.findByText(/does not allow it\. Reduce the quantity/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('no capacity check without a tanker', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toQuantityStep(user, { tanker: false });
    await fillQuantity(user, '999999', '04052');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect((btn('Next') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('duplicates and network loss', () => {
  it('a double tap on Save sends exactly one request', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toReview(user);
    const save = btn('Save fill');
    await Promise.all([user.click(save), user.click(save)]);
    await screen.findByText('Fill recorded');
    expect(posts()).toHaveLength(1);
    expect(world.fills).toHaveLength(1);
  });

  it('a duplicate paper voucher is rejected by the server: back to the quantity step, no pending attempt, nothing recorded twice', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Fill recorded');
    await user.click(btn('Record another fill'));
    await toReview(user, '500', '04052');
    await user.click(btn('Save fill'));
    expect(await screen.findByText('This paper voucher number is already recorded. A voucher is recorded only once.')).toBeTruthy();
    expect(document.querySelector('[data-quantity-step]')).not.toBeNull(); // عاد إلى خطوة الكمية والسند
    expect(document.querySelector('[data-pending-attempt]')).toBeNull();
    expect(world.fills).toHaveLength(1);
  });

  it('reply lost AFTER the server applied it: unresolved attempt → "Check status" finds the voucher → success, never re-posted', async () => {
    setup({ dropReplyAfterApply: true });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    expect(await screen.findByText('Unresolved recording attempt')).toBeTruthy();
    expect(posts()).toHaveLength(1); // لا إعادة تلقائية
    expect(screen.queryByRole('button', { name: 'Resend' })).toBeNull();
    await user.click(btn('Check status'));
    await screen.findByText('Voucher was already recorded (not duplicated)');
    expect(posts()).toHaveLength(1);
    expect(world.fills).toHaveLength(1);
    expect((document.querySelector('[data-fill-number]') as HTMLElement).textContent).toBe('FTF-2027-00001');
    // لم يُجرَ إلا قراءة للتحقق (GET) — مع مرشّح السند الورقي.
    expect(world.gets.some((url) => url.includes('tanker-fills') && url.includes('voucher_number=04052'))).toBe(true);
  });

  it('reply lost BEFORE the server applied it: the check finds nothing, then an explicit resend uses the SAME key and records once', async () => {
    setup({ failBeforeApply: true });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Unresolved recording attempt');
    const firstKey = posts()[0].idempotency_key;
    await user.click(btn('Check status'));
    expect(await screen.findByText(/most likely not recorded/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
    world.failBeforeApply = false;
    await user.click(await screen.findByRole('button', { name: 'Resend' }));
    await screen.findByText('Fill recorded');
    expect(posts()).toHaveLength(2);
    expect(posts()[1].idempotency_key).toBe(firstKey);
    expect(world.fills).toHaveLength(1);
  });

  it('a resend after the server DID apply the first request returns the original (replay) — still one voucher', async () => {
    setup({ dropReplyAfterApply: true });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Unresolved recording attempt');
    // قراءة التحقق تفشل مرة (شبكة) ثم يعيد الموظف الإرسال صراحةً بالمفتاح نفسه بعد أن يجد الخادم الأصل.
    world.dropReplyAfterApply = false;
    const original = world.fills[0];
    original.recorded_at = '2027-01-26T09:00:00+03:00';
    world.fills[0] = { ...original, voucher_number: 'OTHER' }; // التحقق لن يجده (سند مختلف) فيظهر «إعادة الإرسال»
    await user.click(btn('Check status'));
    await screen.findByText(/most likely not recorded/);
    world.fills[0] = original;
    await user.click(screen.getByRole('button', { name: 'Resend' }));
    await screen.findByText('Voucher was already recorded (not duplicated)');
    expect(world.fills).toHaveLength(1);
    expect(posts()).toHaveLength(2);
    expect(posts()[1].idempotency_key).toBe(posts()[0].idempotency_key);
  });

  it('while an attempt is unresolved no new voucher can be started, and it survives a reload', async () => {
    setup({ dropReplyAfterApply: true });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Unresolved recording attempt');
    cleanup();
    mount(); // إعادة تحميل الصفحة (sessionStorage يبقى)
    expect(await screen.findByText('Unresolved recording attempt')).toBeTruthy();
    expect(document.querySelector('[data-tanker-wizard]')).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it('"Discard attempt" is explicit and only offered after a check found nothing', async () => {
    setup({ failBeforeApply: true });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Unresolved recording attempt');
    expect(screen.queryByRole('button', { name: 'Discard attempt' })).toBeNull();
    await user.click(btn('Check status'));
    await user.click(await screen.findByRole('button', { name: 'Discard attempt' }));
    // يعود الموظف إلى مراجعته (لم يُفقد شيء) بلا محاولة معلّقة، ويبقى الإرسال بقرار صريح ومفتاح جديد.
    expect(await screen.findByText('Review before saving')).toBeTruthy();
    expect(document.querySelector('[data-pending-attempt]')).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it('offline: nothing is sent and the attempt is not parked as unresolved', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toReview(user);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await user.click(btn('Save fill'));
    expect(await screen.findByText(/No internet connection\. Nothing was sent/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
    expect(document.querySelector('[data-pending-attempt]')).toBeNull();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await user.click(btn('Save fill'));
    await screen.findByText('Fill recorded');
    expect(posts()).toHaveLength(1);
  });
});

describe('server rejections return the employee to the right step (no auto-retry)', () => {
  it.each([
    ['nozzle_operation_not_allowed', 'This nozzle is not allowed for tanker fills. Choose another nozzle.', '[data-nozzle-step]'],
    ['tanker_required', 'Choosing the tanker is required at this station. Choose a tanker.', '[data-owner-list]'],
    ['quantity_invalid', 'The quantity is not valid. Enter litres greater than zero, up to three decimals.', '[data-quantity-step]'],
    ['capacity_overrun_blocked', 'The quantity exceeds the tanker capacity and the station policy does not allow it.', '[data-quantity-step]'],
  ])('%s', async (reason, message, stepSelector) => {
    setup({ rejectWith: { status: 422, reason } });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(document.querySelector(stepSelector)).not.toBeNull();
    expect(posts()).toHaveLength(1);
    expect(document.querySelector('[data-pending-attempt]')).toBeNull();
  });

  it('shift closed/changed on the server: re-reads the current shift and does not park an unresolved attempt', async () => {
    setup({ rejectWith: { status: 422, reason: 'shift_not_open' } });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    const before = world.gets.filter((url) => url.startsWith('/fuel-stations/shifts')).length;
    await user.click(btn('Save fill'));
    expect(await screen.findByText('The shift that was open is no longer the current one. Check the shift, then try again.')).toBeTruthy();
    await waitFor(() => expect(world.gets.filter((url) => url.startsWith('/fuel-stations/shifts')).length).toBeGreaterThan(before));
    expect(document.querySelector('[data-pending-attempt]')).toBeNull();
  });

  it('after a final rejection a corrected resubmission uses a NEW key (the old one is not reused for different content)', async () => {
    setup({ rejectWith: { status: 422, reason: 'voucher_invalid' } });
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('The paper voucher number is not valid. Correct it and try again.');
    const firstKey = posts()[0].idempotency_key;
    world.rejectWith = null;
    await fillQuantity(user, '2000', '04099');
    await next(user);
    await user.click(await screen.findByRole('button', { name: 'Save fill' }));
    await screen.findByText('Fill recorded');
    expect(posts()[1].idempotency_key).not.toBe(firstKey);
  });
});

describe('employee switching and session isolation', () => {
  it('an unresolved attempt belongs to the employee who made it: another employee does not see it, the first still does', async () => {
    setup({ dropReplyAfterApply: true }, RECORDER, 'u-a');
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Unresolved recording attempt');
    cleanup();

    seedUser(RECORDER, 'u-b');
    mount();
    expect(await screen.findByRole('radio', { name: /Askar/ })).toBeTruthy();
    expect(document.querySelector('[data-pending-attempt]')).toBeNull();
    cleanup();

    seedUser(RECORDER, 'u-a');
    mount();
    expect(await screen.findByText('Unresolved recording attempt')).toBeTruthy();
  });

  it('state does not leak between mounts: a fresh wizard starts empty', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await toReview(user);
    await user.click(btn('Save fill'));
    await screen.findByText('Fill recorded');
    cleanup();
    mount();
    expect(await screen.findByRole('radio', { name: /Askar/ })).toBeTruthy();
    expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('owner search narrows the list through the server, and another owner has no tankers carried over', async () => {
    setup();
    const user = userEvent.setup();
    mount();
    await screen.findByRole('radio', { name: /Askar/ });
    await user.type(screen.getByLabelText('Search by name or code'), 'bak');
    await waitFor(() => expect(world.gets.some((url) => url.includes('q=bak'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('radio', { name: /Askar/ })).toBeNull());
    await user.click(await screen.findByRole('radio', { name: /Bakr/ }));
    expect(await screen.findByText('This owner has no registered tankers. The fill is recorded on their account.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /ABJ 1234/ })).toBeNull();
    expect(OWNER_B).toBeTruthy();
  });
});
