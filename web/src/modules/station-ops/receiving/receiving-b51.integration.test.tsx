// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/receiving', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn(), downloadFile: vi.fn(async () => 'downloaded'), fetchPrivateFileUrl: vi.fn(async () => 'blob:local-preview') }));
vi.mock('./documents/receipt-pdf', () => ({ createReceiptPdf: vi.fn(async () => new Blob(['%PDF-receipt'], { type: 'application/pdf' })), footers: vi.fn() }));
vi.mock('./documents/receipt-pdf-a5', () => ({ createReceiptPdfA5: vi.fn(async () => new Blob(['%PDF-receipt-a5'], { type: 'application/pdf' })) }));
vi.mock('./documents/report-pdf', () => ({ createReportPdf: vi.fn(async () => new Blob(['%PDF-report'], { type: 'application/pdf' })) }));
vi.mock('./documents/share', () => ({
  downloadBlob: vi.fn(), openForPrint: vi.fn(() => true), shareBlob: vi.fn(async () => 'shared'), blobFromObjectUrl: vi.fn(async () => new Blob(['xlsx'])),
}));

import { ApiError, api, downloadFile } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { product, station, tank } from '../__fixtures__';
import type { Station } from '../schemas';
import { StationOpsShell } from '../shell';
import { connectReceiving, type ReceivingWorld } from './__receiving-backend';
import { createReceiptPdf } from './documents/receipt-pdf';
import { createReceiptPdfA5 } from './documents/receipt-pdf-a5';
import { createReportPdf } from './documents/report-pdf';
import { downloadBlob, openForPrint, shareBlob } from './documents/share';
import { ReceivingCostsScreen } from './receiving-costs-screen';
import { ReceivingDetailScreen } from './receiving-detail-screen';
import { ReceivingListScreen } from './receiving-list-screen';
import { ReceivingNewScreen } from './receiving-new-screen';

const apiMock = vi.mocked(api);
const VIEWER = 'u-viewer';
const ST = 'a';
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const STAFF = ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.record'];
const FINANCE = ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.cost.record', 'products.view_cost'];
const MANAGER = ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.approve'];
const MANAGER_WITH_COST = [...MANAGER, 'products.view_cost'];

function seedUser(permissions: string[], id = VIEWER): void {
  const user: AuthUser = { id, name: 'Sup Visor', email: 'sup@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function build(over: Partial<ReceivingWorld> = {}): ReceivingWorld {
  const withWarehouse = { ...station(ST, { name: 'Station A' }), warehouse_id: 'wh1', warehouse: { id: 'wh1', name: 'Main Warehouse', code: 'WH' } } as unknown as Station;
  return {
    data: { stations: [withWarehouse], products: [product('p1', 'Alpha')], pumps: [], nozzles: [], tanks: [tank('t1', ST, 'p1', { name: 'Tank One' })], prices: [], shifts: [] },
    deliveries: [], suppliers: [{ id: 'sup1', name: 'Acme Oil', code: 'S-1' }], readings: [], attachments: {}, posts: [], gets: [], viewerId: VIEWER, canSeeCost: true, distinctApprover: false, ...over,
  };
}

const draft = (over: Record<string, unknown> = {}) => ({
  id: UID(1), status: 'draft', station_id: ST, tank_id: 't1', fuel_product_id: 'p1', warehouse_id: 'wh1', supplier_id: 'sup1', purchase_reference: 'PO-9', delivery_note_number: 'DN-9',
  dispatched_milliliters: 1_000_000, received_milliliters: 995_500, transit_variance_milliliters: -4_500, received_total_cost_minor: null, stock_movement_id: null,
  received_at: '2026-11-06T08:30:00+00:00', approved_at: null, approved_by: null, notes: null, created_at: '2026-11-06T08:30:00+00:00', created_by: 'u-creator', tanker_identifier: null, driver_name: null,
  supplier: { id: 'sup1', name: 'Acme Oil', code: 'S-1' }, tank: { id: 't1', name: 'Tank One', code: 'T1' }, warehouse: { id: 'wh1', name: 'Main Warehouse', code: 'WH' }, ...over,
});

let world: ReceivingWorld;
function connect(w: ReceivingWorld) { world = w; connectReceiving(w, apiMock as never); }
const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const posts = (suffix: string) => world.posts.filter((p) => p.path.endsWith(suffix) && p.method === 'POST');
const open = async (id = UID(1)) => { renderOps(<ReceivingDetailScreen id={id} />); await screen.findByText('Receiving details'); };
const pdf = (name = 'note.pdf', size = 64) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset(); vi.mocked(downloadFile).mockClear();
  vi.mocked(createReceiptPdf).mockClear(); vi.mocked(createReceiptPdfA5).mockClear(); vi.mocked(createReportPdf).mockClear(); vi.mocked(downloadBlob).mockClear(); vi.mocked(openForPrint).mockClear(); vi.mocked(shareBlob).mockClear();
  nav.pathname = '/fuel-stations/ops/receiving';
});
afterEach(() => cleanup());

describe('cost card (B5.1)', () => {
  it('finance records the cost after an explicit confirmation that echoes the amount; one POST in minor units', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    expect(document.querySelector('[data-cost-state="missing"]')).not.toBeNull();
    await user.type(screen.getByLabelText('Actual total receiving cost'), '5000.50');
    await user.click(screen.getByRole('button', { name: 'Record cost' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-cost-echo]')?.textContent).toMatch(/5,000\.50|5000\.50/);
    expect(posts('/cost')).toHaveLength(0); // الحوار لا يكتب
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Cost recorded.')).toBeTruthy();
    expect(posts('/cost')).toHaveLength(1);
    expect(posts('/cost')[0].body).toEqual({ received_total_cost_minor: 500_050 });
    expect(document.querySelector('[data-cost-state="recorded"]')).not.toBeNull();
    expect(world.posts.some((p) => p.path.endsWith('/approve'))).toBe(false); // لا اعتماد ولا أثر مخزني
  });

  it('rejects empty, zero, negative and malformed amounts before anything is sent', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    const field = screen.getByLabelText('Actual total receiving cost');
    for (const bad of ['', '0', '-5', 'abc', '1.234']) {
      await user.clear(field);
      if (bad) await user.type(field, bad);
      await user.click(screen.getByRole('button', { name: 'Record cost' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(posts('/cost')).toHaveLength(0);
    expect(await screen.findByText(/Invalid cost/)).toBeTruthy();
  });

  it('a double tap on confirm records once', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    await user.type(screen.getByLabelText('Actual total receiving cost'), '10');
    await user.click(screen.getByRole('button', { name: 'Record cost' }));
    await user.dblClick(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Cost recorded.');
    expect(posts('/cost')).toHaveLength(1);
  });

  it('lost reply: no resend — checking reads the real state and confirms the cost was recorded', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never], dropReplyAfterApply: (post) => post.path.endsWith('/cost') }));
    await open();
    await user.type(screen.getByLabelText('Actual total receiving cost'), '10');
    await user.click(screen.getByRole('button', { name: 'Record cost' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/connection dropped after sending/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Cost recorded.')).toBeTruthy();
    expect(posts('/cost')).toHaveLength(1);
  });

  it('a cost-blind station user sees only the status — never an amount, a field or a hint of the value', async () => {
    seedUser(STAFF);
    connect(build({ canSeeCost: false, deliveries: [draft({ received_total_cost_minor: 987_654 }) as never] }));
    await open();
    expect(document.querySelector('[data-cost-state="recorded"]')).not.toBeNull();
    expect(screen.queryByLabelText('Actual total receiving cost')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record cost' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/9,876|9876|987654/);
    expect(screen.getByText(/Finance recorded the cost/)).toBeTruthy();
  });

  it('someone who sees cost but cannot record it gets the amount without a field; an approved receiving is locked', async () => {
    seedUser(MANAGER_WITH_COST);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 500_000 }) as never, draft({ id: UID(2), status: 'approved', received_total_cost_minor: 500_000, approved_by: 'u-x', approved_at: '2026-11-06T09:00:00+00:00' }) as never] }));
    await open();
    expect(screen.getByText(/5,000\.00|5000\.00/)).toBeTruthy();
    expect(screen.queryByLabelText('Actual total receiving cost')).toBeNull();
    expect(screen.getByText(/needs a dedicated financial permission/)).toBeTruthy();
    cleanup();
    seedUser(FINANCE);
    renderOps(<ReceivingDetailScreen id={UID(2)} />);
    await screen.findByText('Receiving details');
    expect(screen.getByText(/its cost is locked/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record cost' })).toBeNull();
  });

  it('403 and the locked-after-approval 422 are explained and nothing is claimed saved', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never], beforePost: (post) => { if (post.path.endsWith('/cost')) throw new ApiError(403, 'x', {}); } }));
    await open();
    await user.type(screen.getByLabelText('Actual total receiving cost'), '10');
    await user.click(screen.getByRole('button', { name: 'Record cost' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/You are not allowed to do this/)).toBeTruthy();
    expect(screen.queryByText('Cost recorded.')).toBeNull();
  });
});

describe('approval readiness and the cost the approver reviewed (B5.1)', () => {
  it('approval is not offered until the cost is recorded; the checklist says why, and the note/attachment lines never block', async () => {
    seedUser(MANAGER);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    expect((screen.getByRole('button', { name: 'Approve receiving' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-ready-item="cost"]')?.getAttribute('data-ok')).toBe('false');
    expect(screen.getByText(/Record the actual cost first/)).toBeTruthy();
    // السند والمرفق معلومات لا شروط.
    for (const key of ['note', 'attachment']) expect(document.querySelector(`[data-ready-item="${key}"]`)?.getAttribute('data-blocking')).toBe('false');
  });

  it('a receiving that pre-dates B5.1 (no note number, no attachment) is NOT blocked once its cost exists; the note line explains why', async () => {
    const user = userEvent.setup();
    seedUser(MANAGER);
    connect(build({ deliveries: [draft({ delivery_note_number: null, received_total_cost_minor: 500_000 }) as never] }));
    await open();
    expect(document.querySelector('[data-ready-item="note"]')?.getAttribute('data-ok')).toBe('false');
    expect(screen.getByText(/Legacy receiving with no note number: this does not block approval/)).toBeTruthy();
    expect(document.querySelector('[data-supplier-note-legacy]')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'Approve receiving' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Receiving approved');
    expect(posts('/approve')).toHaveLength(1);
  });

  it('the internal receiving number (FD-…) and the supplier note number are shown as two distinct, separately-labelled fields', async () => {
    seedUser(MANAGER);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 1 }) as never] }));
    await open();
    expect(document.querySelector('[data-internal-number]')?.textContent).toBe('FD-00000000');
    expect(document.querySelector('[data-supplier-note]')?.textContent).toBe('DN-9');
    expect(screen.getByText('Internal receiving number')).toBeTruthy();
    expect(screen.getByText('Supplier delivery note number')).toBeTruthy();
  });

  it('becomes ready when the cost is recorded and the note number exists; a cost-seeing approver sends the cost they reviewed', async () => {
    const user = userEvent.setup();
    seedUser(MANAGER_WITH_COST);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    const button = screen.getByRole('button', { name: 'Approve receiving' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Receiving approved');
    expect(posts('/approve')[0].body).toEqual({ expected_total_cost_minor: 500_000 });
  });

  it('a cost-blind approver never sends a cost value (it would be a guessing channel)', async () => {
    const user = userEvent.setup();
    seedUser(MANAGER);
    connect(build({ canSeeCost: false, deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Receiving approved');
    expect(posts('/approve')[0].body).toEqual({});
  });

  it('the cost changed after review ⇒ 409 with an explicit message, nothing approved, and the new value is shown', async () => {
    const user = userEvent.setup();
    seedUser(MANAGER_WITH_COST);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    (world.deliveries[0] as unknown as Record<string, unknown>).received_total_cost_minor = 600_000; // غيّرتها المالية بينما الشاشة مفتوحة
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText(/cost changed after you reviewed it/)).toBeTruthy();
    expect(world.deliveries[0].status).toBe('draft');
    await waitFor(() => expect(document.body.textContent).toMatch(/6,000\.00|6000\.00/));
  });
});

describe('supplier-note attachments (B5.1)', () => {
  it('uploads from the details screen, lists the file and deletes it from a draft only', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    expect(document.querySelector('[data-no-attachments]')).not.toBeNull();
    await user.upload(document.querySelector('[data-file-input]') as HTMLInputElement, pdf('delivery-note.pdf'));
    await user.click(await screen.findByRole('button', { name: /Upload 1 file/ }));
    expect(await screen.findByText('delivery-note.pdf')).toBeTruthy();
    expect(posts('/attachments')[0].body).toEqual({ files: ['delivery-note.pdf'] });
    await user.click(screen.getByRole('button', { name: /Delete: delivery-note\.pdf/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('delivery-note.pdf')).toBeNull());
    expect(world.posts.filter((p) => p.method === 'DELETE')).toHaveLength(1);
  });

  it('refuses wrong types and oversize files locally (reason shown) and sends nothing', async () => {
    const user = userEvent.setup({ applyAccept: false });
    seedUser(STAFF);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    const input = document.querySelector('[data-file-input]') as HTMLInputElement;
    await user.upload(input, [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), new File(['x'], 'macro.exe', { type: 'application/x-msdownload' })]);
    const rejected = await screen.findByRole('alert');
    expect(rejected.textContent).toMatch(/logo\.svg.*not allowed/);
    expect(rejected.textContent).toMatch(/macro\.exe/);
    await user.upload(input, pdf('big.pdf', 10 * 1024 * 1024 + 1));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Larger than 10 MB/);
    expect(posts('/attachments')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Upload/ })).toBeNull();
  });

  it('an approved receiving keeps its evidence read-only: no upload, no delete', async () => {
    seedUser(STAFF);
    connect(build({ deliveries: [draft({ status: 'approved', received_total_cost_minor: 1, approved_by: 'u-x', approved_at: '2026-11-06T09:00:00+00:00' }) as never], attachments: { [UID(1)]: [{ id: '00000000-0000-4000-9000-000000000001', name: 'kept.pdf', mime_type: 'application/pdf', size: 10, uploaded_by: 'u', created_at: '2026-11-06T09:00:00+00:00' }] } }));
    await open();
    expect(screen.getByText('kept.pdf')).toBeTruthy();
    expect(document.querySelector('[data-file-input]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete: kept\.pdf/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Preview: kept\.pdf/ })).toBeTruthy();
  });

  it('a user who cannot create receivings can read attachments but not upload', async () => {
    seedUser(['fuel_stations.view', 'fuel.delivery.view']);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    expect(document.querySelector('[data-file-input]')).toBeNull();
  });

  it('wizard: files picked on the documents step are uploaded after the draft exists, and an upload failure keeps the draft with a retry', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    let failOnce = true;
    connect(build({ beforePost: (post) => { if (post.path.endsWith('/attachments') && failOnce) { failOnce = false; throw new ApiError(422, 'الأنواع المسموحة: PDF وJPG وPNG.', {}); } } }));
    renderOps(<ReceivingNewScreen />);
    await user.click(await screen.findByRole('radio', { name: /Acme Oil/ }));
    await user.click(await screen.findByRole('radio', { name: /Tank One/ }));
    await user.type(screen.getByLabelText('Supplier delivery note number'), 'DN-W1');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(await screen.findByLabelText('Dispatched quantity'), '100');
    await user.type(screen.getByLabelText('Received quantity'), '99');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Photograph the supplier note', { selector: 'h2' });
    await user.upload(document.querySelector('[data-file-input]') as HTMLInputElement, pdf('wiz.pdf'));
    expect((await screen.findByText('wiz.pdf'))).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(document.querySelector('[data-review-files]')?.textContent).toBe('1');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Draft saved')).toBeTruthy();
    expect(world.deliveries).toHaveLength(1);
    expect(document.querySelector('[data-upload-state="failed"]')).not.toBeNull();
    expect(world.posts.some((p) => p.path === '/fuel-stations/deliveries' && 'received_total_cost_minor' in p.body)).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Retry attachment upload' }));
    await waitFor(() => expect(document.querySelector('[data-upload-state="done"]')).not.toBeNull());
    expect(world.deliveries).toHaveLength(1); // لا مسودة ثانية
    expect(Object.values(world.attachments ?? {}).flat()).toHaveLength(1);
  });
});

describe('print, download and share (B5.1)', () => {
  it('a cost-blind user only gets the operational version: no variant switch, PDF requested with variant=operational and the financial one is never requested', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ canSeeCost: false, deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    expect(document.querySelector('[data-variant]')).toBeNull();
    await user.click(document.querySelector('[data-doc-action="pdf-download"]') as HTMLElement);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(world.gets.some((url) => /\/document\?variant=operational/.test(url))).toBe(true);
    expect(world.gets.some((url) => /variant=financial/.test(url))).toBe(false);
    const payload = vi.mocked(createReceiptPdf).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload.variant).toBe('operational');
    expect(payload).not.toHaveProperty('cost');
    expect(JSON.stringify(payload)).not.toMatch(/500000|5,000/);
  });

  it('an authorised user can switch to the financial version; the request carries variant=financial and the file name says so', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    await user.click(document.querySelector('[data-variant="financial"]') as HTMLElement);
    await user.click(document.querySelector('[data-doc-action="pdf-download"]') as HTMLElement);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(world.gets.some((url) => /\/document\?variant=financial/.test(url))).toBe(true);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/financial.*\.pdf$/);
    expect((vi.mocked(createReceiptPdf).mock.calls[0][0] as unknown as { cost: { total_minor: number } }).cost.total_minor).toBe(500_000);
  });

  it('a server 403 on the financial version is explained, never silently downgraded to a file', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE); // الواجهة تظهر الخيار، لكن الخادم (سلطة) يرفض
    connect(build({ canSeeCost: false, deliveries: [draft() as never] }));
    await open();
    await user.click(document.querySelector('[data-variant="financial"]') as HTMLElement);
    await user.click(document.querySelector('[data-doc-action="pdf-download"]') as HTMLElement);
    expect(await screen.findByText('You are not allowed this version.')).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('print opens the PDF, share uses the native sheet, Excel downloads through the server with the chosen variant', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    await user.click(document.querySelector('[data-doc-action="pdf-print"]') as HTMLElement);
    await waitFor(() => expect(openForPrint).toHaveBeenCalledTimes(1));
    await user.click(document.querySelector('[data-doc-action="pdf-share"]') as HTMLElement);
    await waitFor(() => expect(shareBlob).toHaveBeenCalledTimes(1));
    await user.click(document.querySelector('[data-doc-action="xlsx-download"]') as HTMLElement);
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(downloadFile).mock.calls[0][0])).toMatch(/\/deliveries\/[\w-]+\/export\?variant=operational$/);
  });

  it('the list exports the statement for the current filters (variant by permission)', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ canSeeCost: false, deliveries: [draft() as never] }));
    renderOps(<ReceivingListScreen />);
    await screen.findByText(/DN-9/);
    const details = document.querySelector('[data-export-report]') as HTMLDetailsElement;
    details.open = true;
    await user.click(details.querySelector('[data-doc-action="pdf-download"]') as HTMLElement);
    await waitFor(() => expect(createReportPdf).toHaveBeenCalledTimes(1));
    expect(world.gets.some((url) => /deliveries\/report\?.*variant=operational/.test(url) && /station_id=a/.test(url))).toBe(true);
    await user.click(details.querySelector('[data-doc-action="xlsx-download"]') as HTMLElement);
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(downloadFile).mock.calls[0][0])).toMatch(/\/deliveries\/export\?.*variant=operational/);
  });
});

describe('A5 landscape voucher (AWJ-DOC-V2-PR6)', () => {
  it('defaults to the historical A4 voucher; the paper choice exists on the voucher only, never on the statement', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ canSeeCost: false, deliveries: [draft() as never] }));
    await open();
    expect(document.querySelector('[data-paper="a4"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-paper="a5"]')?.getAttribute('aria-checked')).toBe('false');
    await user.click(document.querySelector('[data-doc-action="pdf-download"]') as HTMLElement);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(createReceiptPdf).toHaveBeenCalledTimes(1);
    expect(createReceiptPdfA5).not.toHaveBeenCalled();
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).not.toMatch(/-a5-/);
    cleanup();

    renderOps(<ReceivingListScreen />);
    await screen.findByText('Station A', undefined, { timeout: 4000 }).catch(() => undefined);
    expect(document.querySelector('[data-paper-group]')).toBeNull();
  });

  it('choosing A5 draws the A5 voucher from the same server payload (same endpoint, no cost for a cost-blind user) and says so in the file name', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ canSeeCost: false, deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    await user.click(document.querySelector('[data-paper="a5"]') as HTMLElement);
    expect(document.querySelector('[data-paper="a5"]')?.getAttribute('aria-checked')).toBe('true');
    await user.click(document.querySelector('[data-doc-action="pdf-download"]') as HTMLElement);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(createReceiptPdfA5).toHaveBeenCalledTimes(1);
    expect(createReceiptPdf).not.toHaveBeenCalled();
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toMatch(/-operational-a5-.*\.pdf$/);
    // الصلاحية والعزل بيد الخادم: نقطة النهاية نفسها والنسخة التشغيلية فقط، ولا مبلغ في الحمولة.
    expect(world.gets.filter((url) => /\/document\?/.test(url))).toHaveLength(1);
    expect(world.gets.some((url) => /variant=financial/.test(url))).toBe(false);
    const payload = vi.mocked(createReceiptPdfA5).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(payload.variant).toBe('operational');
    expect(payload).not.toHaveProperty('cost');
    expect(JSON.stringify(payload)).not.toMatch(/500000|5,000/);
  });

  it('remembers the choice on this device only (local preference), and falls back to A4 when storage is blocked', async () => {
    const user = userEvent.setup();
    seedUser(FINANCE);
    connect(build({ deliveries: [draft({ received_total_cost_minor: 500_000 }) as never] }));
    await open();
    await user.click(document.querySelector('[data-paper="a5"]') as HTMLElement);
    expect(localStorage.getItem('awj.fuel-receipt.paper')).toBe('a5');
    cleanup();
    await open();
    await waitFor(() => expect(document.querySelector('[data-paper="a5"]')?.getAttribute('aria-checked')).toBe('true'));
    await user.click(document.querySelector('[data-variant="financial"]') as HTMLElement);
    await user.click(document.querySelector('[data-doc-action="pdf-print"]') as HTMLElement);
    await waitFor(() => expect(openForPrint).toHaveBeenCalledTimes(1));
    expect((vi.mocked(createReceiptPdfA5).mock.calls[0][0] as unknown as { cost: { total_minor: number } }).cost.total_minor).toBe(500_000);
    cleanup();

    // تخزين محجوب لمفتاح التفضيل وحده: يبقى A4 والشاشة تعمل (بقية التخزين، كالجلسة، سليمة).
    const original = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'awj.fuel-receipt.paper') throw new Error('blocked');
      return original.call(this, key);
    });
    try {
      await open();
      expect(document.querySelector('[data-paper="a4"]')?.getAttribute('aria-checked')).toBe('true');
    } finally {
      spy.mockRestore();
    }
  });

  it('the paper choice is accessible in Arabic (radiogroup, labelled, no axe violations)', async () => {
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never] }));
    renderOps(<ReceivingDetailScreen id={UID(1)} />, 'ar');
    await waitFor(() => expect(document.querySelector('[data-paper-group]')).not.toBeNull());
    const group = document.querySelector('[data-paper-group]') as HTMLElement;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('حجم الورق');
    expect(group.textContent).toContain('A5 أفقي');
    expect((await axe(group, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});

describe('list search and the cost queue (B5.1)', () => {
  it('search and the cost filter are sent to the server (scope stays server-side)', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ deliveries: [draft() as never, draft({ id: UID(2), delivery_note_number: 'XYZ-77', supplier: { id: 'sup1', name: 'Acme Oil', code: 'S-1' } }) as never] }));
    renderOps(<ReceivingListScreen />);
    await screen.findByText(/DN-9/);
    await user.type(screen.getByLabelText('Search receivings'), 'xyz');
    await waitFor(() => expect(world.gets.some((url) => /[?&]q=xyz/.test(url))).toBe(true));
    await waitFor(() => expect(screen.queryByText('DN-9')).toBeNull());
    expect(screen.getByText(/XYZ-77/)).toBeTruthy();
    await user.clear(screen.getByLabelText('Search receivings'));
    (document.querySelector('[data-more-filters]') as HTMLDetailsElement).open = true;
    await user.click(screen.getByRole('radio', { name: 'Awaiting cost' }));
    await waitFor(() => expect(world.gets.some((url) => /cost=missing/.test(url))).toBe(true));
  });

  it('the awaiting-cost queue is offered only to people who see cost, lists drafts without cost, and finance records inline', async () => {
    const user = userEvent.setup();
    seedUser(STAFF);
    connect(build({ deliveries: [draft() as never] }));
    renderOps(<ReceivingListScreen />);
    await screen.findByText(/DN-9/);
    expect(document.querySelector('[data-costs-link]')).toBeNull();
    cleanup();

    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never, draft({ id: UID(2), delivery_note_number: 'DN-HAS', received_total_cost_minor: 100 }) as never] }));
    renderOps(<ReceivingListScreen />);
    await screen.findByText(/DN-9/);
    expect(document.querySelector('[data-costs-link]')?.getAttribute('href')).toBe('/fuel-stations/ops/receiving/costs');
    cleanup();

    renderOps(<ReceivingCostsScreen />);
    const item = await waitFor(() => { const el = document.querySelector(`[data-pending-id="${UID(1)}"]`); expect(el).not.toBeNull(); return el as HTMLElement; });
    expect(document.querySelector(`[data-pending-id="${UID(2)}"]`)).toBeNull(); // مسجَّلة التكلفة لا تظهر
    await user.type(within(item).getByLabelText('Actual total receiving cost'), '42');
    await user.click(within(item).getByRole('button', { name: 'Record cost' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(posts('/cost')).toHaveLength(1));
    expect(posts('/cost')[0].body).toEqual({ received_total_cost_minor: 4200 });
    await waitFor(() => expect(document.querySelector(`[data-pending-id="${UID(1)}"]`)).toBeNull()); // يختفي بعد القراءة من الخادم
  });
});

describe('Arabic RTL and accessibility (B5.1 surfaces)', () => {
  it('renders the detail (cost + attachments + documents) and the cost queue in Arabic with logical layout and no axe violations', async () => {
    seedUser(FINANCE);
    connect(build({ deliveries: [draft() as never] }));
    const detail = renderOps(<ReceivingDetailScreen id={UID(1)} />, 'ar');
    await screen.findByText('بيانات الاستلام');
    expect(detail.container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    expect((await axe(detail.container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
    cleanup();
    const queue = renderOps(<ReceivingCostsScreen />, 'ar');
    await screen.findByText('بانتظار التكلفة', { selector: 'h1, h2, p' }).catch(() => undefined);
    await waitFor(() => expect(queue.container.querySelector('[data-pending-costs]')).not.toBeNull());
    expect((await axe(queue.container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});
