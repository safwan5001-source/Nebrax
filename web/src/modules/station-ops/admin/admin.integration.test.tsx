// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/manage', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { shift, station } from '../__fixtures__';
import { StationOpsShell } from '../shell';
import { connectAdmin, type AdminWorld } from './__admin-backend';
import { CATALOG, MANAGER, SELLER, UID, auditEvent, staff, templates } from './__fixtures__';
import { AuditScreen } from './audit-screen';
import { ManageScreen } from './manage-screen';
import { PermissionsScreen } from './permissions-screen';
import { StaffEditorScreen } from './staff-editor-screen';
import { StaffListScreen } from './staff-list-screen';

const apiMock = vi.mocked(api);
const ADMIN = ['fuel_stations.view', 'fuel.shift.view', 'fuel.staff.manage', 'fuel.sale.price.manage'];
const EMP = UID(1);
const OTHER = UID(2);
const ST_A = UID(100);
const ST_B = UID(101);

function seedUser(permissions: string[], id = 'u-admin'): void {
  const user: AuthUser = { id, name: 'Admin One', email: 'admin@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function build(over: Partial<AdminWorld> = {}): AdminWorld {
  return {
    data: { stations: [station(ST_A, { name: 'Station A' }), station(ST_B, { name: 'Station B' })], products: [], pumps: [], nozzles: [], tanks: [], prices: [], shifts: [shift('s1', ST_A, { status: 'open' }), shift('s2', ST_A, { status: 'closed' })] },
    staff: [staff(EMP, 'Emp One', { station_ids: [ST_A], revision: 'rev-1' }), staff(OTHER, 'Emp Two', { template: 'none', fuel_permissions: [], station_ids: [], revision: 'rev-2' })],
    templates: templates(),
    candidates: [{ id: UID(3), name: 'Cand Three', email: 'cand@example.test', is_active: true }],
    audit: [], puts: [], gets: [], ...over,
  };
}

let world: AdminWorld;
function connect(w: AdminWorld) { world = w; connectAdmin(w, apiMock as never); }

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset();
  nav.pathname = '/fuel-stations/ops/manage';
});
afterEach(() => cleanup());

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const staffCalls = () => apiMock.mock.calls.filter(([path]) => String(path).startsWith('/fuel-stations/staff'));

describe('visibility follows real permissions', () => {
  it('a seller sees no Manage entry and the staff screen sends no staff request at all', async () => {
    seedUser(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open']);
    connect(build());
    renderOps(<StaffListScreen />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull();
    expect(staffCalls()).toHaveLength(0);
  });

  it('the audit screen is forbidden without the staff permission and sends nothing', async () => {
    seedUser(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.approve']);
    connect(build());
    renderOps(<AuditScreen />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(staffCalls()).toHaveLength(0);
  });

  it('a supervisor with approval rights but no admin rights gets the empty management hub, not a list of actions', async () => {
    seedUser(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.approve']);
    connect(build());
    renderOps(<ManageScreen />);
    expect(await screen.findByText('No management sections available')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Staff/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Fuel prices/ })).toBeNull();
  });

  it('shows Manage in the bottom navigation only to administrators', async () => {
    seedUser(ADMIN);
    connect(build());
    renderOps(<ManageScreen />);
    expect(await screen.findByText('Station summary')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Manage' }).length).toBeGreaterThan(0);
  });
});

describe('management hub', () => {
  it('summarises the selected station and links the sections the user may use — prices go to the existing screen', async () => {
    seedUser(ADMIN);
    connect(build());
    renderOps(<ManageScreen />);
    const summary = (await screen.findByText('Station summary')).closest('section') as HTMLElement;
    await waitFor(() => expect(within(summary).getByText('Assigned staff').nextElementSibling?.textContent).toBe('1'));
    expect(within(summary).getByText('Open shifts').nextElementSibling?.textContent).toBe('1');
    expect(within(summary).getByText('Closed shifts').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByRole('link', { name: /Staff/ }).getAttribute('href')).toBe('/fuel-stations/ops/manage/staff');
    expect(screen.getByRole('link', { name: /Change log/ }).getAttribute('href')).toBe('/fuel-stations/ops/manage/audit');
    expect(screen.getByRole('link', { name: /Fuel prices/ }).getAttribute('href')).toBe('/fuel-stations/prices');
  });

  it('hides the prices link without the price permission and the staff sections without the staff permission', async () => {
    seedUser(['fuel_stations.view', 'fuel.sale.price.manage']);
    connect(build());
    renderOps(<ManageScreen />);
    expect(await screen.findByRole('link', { name: /Fuel prices/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Staff/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Change log/ })).toBeNull();
    expect(staffCalls()).toHaveLength(0);
  });
});

describe('staff list', () => {
  it('shows each employee with template, permission count and stations, and warns that no station means no access', async () => {
    seedUser(ADMIN);
    connect(build());
    renderOps(<StaffListScreen />);
    const first = (await screen.findByRole('link', { name: /Emp One/ })).closest('li') as HTMLElement;
    expect(within(first).getByText('Seller')).toBeTruthy();
    expect(within(first).getByText('Station A')).toBeTruthy();
    expect(within(first).getByText('5 permissions')).toBeTruthy();
    const second = screen.getByRole('link', { name: /Emp Two/ }).closest('li') as HTMLElement;
    expect(within(second).getByText('No stations — no access')).toBeTruthy();
    expect(screen.getByText(/cannot reach any station/)).toBeTruthy();
  });

  it('adds an employee from the candidate list without changing anything yet', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    renderOps(<StaffListScreen />);
    await user.click(await screen.findByRole('button', { name: /Add an employee/ }));
    const dialog = await screen.findByRole('dialog');
    const link = await within(dialog).findByRole('link', { name: /Cand Three/ });
    expect(link.getAttribute('href')).toBe(`/fuel-stations/ops/manage/staff/${UID(3)}`);
    expect(world.puts).toHaveLength(0);
  });
});

describe('permission editor', () => {
  const open = async (id = EMP, locale: 'en' | 'ar' = 'en') => { renderOps(<StaffEditorScreen id={id} />, locale); await screen.findByRole('radiogroup'); };
  const reviewButton = () => screen.getByRole('button', { name: /Review and save|No changes|مراجعة وحفظ|لا توجد تغييرات/ });

  it('loads the employee read-only: no request except GETs, and the save button is disabled until something changes', async () => {
    seedUser(ADMIN);
    connect(build());
    await open();
    expect((reviewButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /Seller/ }).getAttribute('aria-checked')).toBe('true');
    expect(world.puts).toHaveLength(0);
    expect(apiMock.mock.calls.every(([, init]) => (init as { method?: string } | undefined)?.method !== 'PUT')).toBe(true);
  });

  it('applies a template as a delta, shows the difference in the review dialog, and writes only after explicit confirmation', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    await open();
    await user.click(screen.getByRole('radio', { name: /^Supervisor/ }));
    expect(screen.getByRole('radio', { name: /^Supervisor/ }).getAttribute('aria-checked')).toBe('true');
    expect(world.puts).toHaveLength(0); // لا حفظ تلقائي
    await user.click(reviewButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Permissions to be added')).toBeTruthy();
    expect(world.puts).toHaveLength(0); // الحوار لا يكتب
    await user.type(within(dialog).getByLabelText('Reason for the change (optional)'), '  Covering the weekend  ');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(world.puts).toHaveLength(1));
    expect(world.puts[0].path).toBe(`/fuel-stations/staff/${EMP}`);
    expect(world.puts[0].body.expected_revision).toBe('rev-1');
    expect(world.puts[0].body.reason).toBe('Covering the weekend');
    expect(world.puts[0].body).not.toHaveProperty('template');
    expect(world.puts[0].body).not.toHaveProperty('remove_permissions');
    expect((world.puts[0].body.add_permissions as string[])).toContain('fuel.shift.approve');
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Supervisor/ }).getAttribute('aria-checked')).toBe('true');
    expect((reviewButton() as HTMLButtonElement).disabled).toBe(true); // نظيف بعد الحفظ
  });

  it('customises a single permission without touching the rest and marks the group as changed', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    await open();
    await user.click(screen.getByText('Receiving, readings and reconciliation'));
    await user.click(screen.getByRole('switch', { name: /Tank readings — View/ }));
    await user.click(reviewButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Tank readings — View/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(world.puts).toHaveLength(1));
    expect(world.puts[0].body).toMatchObject({ add_permissions: ['fuel.reading.view'] });
    expect(world.puts[0].body).not.toHaveProperty('remove_permissions');
    expect(world.puts[0].body).not.toHaveProperty('station_ids');
  });

  it('locks reserved and non-delegable permissions: they cannot be switched on from the screen', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    await open();
    await user.click(screen.getByText('Governance and administration'));
    const gov = screen.getByRole('switch', { name: /Fuel governance/ }) as HTMLButtonElement;
    expect(gov.disabled).toBe(true);
    expect(screen.getAllByText('Reserved: only the owner can grant it').length).toBeGreaterThan(0);
    await user.click(screen.getByText('Station data'));
    const manage = screen.getByRole('switch', { name: /Fuel stations — Manage/ }) as HTMLButtonElement;
    expect(manage.disabled).toBe(true);
    expect(screen.getAllByText('Beyond what you can delegate').length).toBeGreaterThan(0);
  });

  it('select-everything-I-can-delegate never adds a reserved or non-delegable key', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    await open();
    await user.click(screen.getByRole('button', { name: 'Select everything I can delegate' }));
    await user.click(reviewButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(world.puts).toHaveLength(1));
    const added = world.puts[0].body.add_permissions as string[];
    expect(added.length).toBeGreaterThan(5);
    for (const key of ['fuel.governance.manage', 'fuel.staff.manage', 'fuel_stations.manage']) expect(added).not.toContain(key);
    for (const key of added) expect(CATALOG).toContain(key);
  });

  it('disables a template the actor cannot delegate and says why', async () => {
    seedUser(ADMIN);
    connect(build({ templates: templates({ templates: templates().templates.map((tpl) => (tpl.key === 'station_manager' ? { ...tpl, assignable: false } : tpl)) }) }));
    await open();
    const radio = screen.getByRole('radio', { name: /Station manager/ }) as HTMLButtonElement;
    expect(radio.disabled).toBe(true);
    expect(screen.getByText('Above your permissions: you cannot delegate it')).toBeTruthy();
  });

  it('assigns stations from the actor’s own list only, warns when none remain, and sends the full new list', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    await open();
    const picker = screen.getByRole('checkbox', { name: /Station A/ });
    expect(picker.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('checkbox', { name: /Station Z/ })).toBeNull();
    await user.click(picker);
    expect(screen.getByText(/after saving, this employee will not reach any station/i)).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: /Station B/ }));
    await user.click(reviewButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Stations to be added')).toBeTruthy();
    expect(within(dialog).getByText('Stations to be removed')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(world.puts).toHaveLength(1));
    expect(world.puts[0].body.station_ids).toEqual([ST_B]);
  });

  it('warns in the review dialog when saving would leave the employee with no station at all', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build());
    await open();
    await user.click(screen.getByRole('checkbox', { name: /Station A/ }));
    await user.click(reviewButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will have no station/)).toBeTruthy();
  });

  it('blocks editing your own account (the server forbids self-escalation anyway)', async () => {
    seedUser(ADMIN, EMP);
    connect(build());
    await open();
    expect(screen.getByText(/cannot change your own permissions/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /^Supervisor/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Select everything I can delegate' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('write outcomes never lose the user’s edits', () => {
  const edit = async (user: ReturnType<typeof userEvent.setup>) => {
    renderOps(<StaffEditorScreen id={EMP} />);
    await screen.findByRole('radiogroup');
    await user.click(screen.getByRole('radio', { name: /^Supervisor/ }));
    await user.click(screen.getByRole('button', { name: /Review and save|No changes/ }));
    return await screen.findByRole('dialog');
  };
  const confirm = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));

  it('409: keeps the edits, offers reapply-or-discard, reapplies on top of the newer state and saves with the new revision', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build({
      concurrentEdit: (w) => {
        if (w.puts.length !== 1) return;
        const row = w.staff.find((s) => s.user.id === EMP)!;
        row.fuel_permissions = [...row.fuel_permissions, 'fuel.reading.view'].sort(); // مسؤول آخر أضاف صلاحية
        row.revision = 'rev-other';
      },
    }));
    const dialog = await edit(user);
    await confirm(user, dialog);
    const banner = await screen.findByText('Another administrator changed this employee');
    expect(banner).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Supervisor/ }).getAttribute('aria-checked')).toBe('true'); // التعديلات لم تضِع
    expect(world.staff.find((s) => s.user.id === EMP)!.template).toBe('seller'); // لم يُكتب شيء
    await user.click(screen.getByRole('button', { name: 'Refresh and reapply my edits' }));
    await waitFor(() => expect(screen.queryByText('Another administrator changed this employee')).toBeNull());
    await user.click(screen.getByRole('button', { name: /Review and save|No changes/ }));
    const second = await screen.findByRole('dialog');
    await confirm(user, second);
    await waitFor(() => expect(world.puts).toHaveLength(2));
    expect(world.puts[1].body.expected_revision).toBe('rev-other');
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('409: discard loads the latest state and drops the edits', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build({ concurrentEdit: (w) => { if (w.puts.length === 1) w.staff.find((s) => s.user.id === EMP)!.revision = 'rev-other'; } }));
    const dialog = await edit(user);
    await confirm(user, dialog);
    await user.click(await screen.findByRole('button', { name: 'Discard my edits and load latest' }));
    await waitFor(() => expect(screen.queryByText('Another administrator changed this employee')).toBeNull());
    expect((screen.getByRole('button', { name: 'No changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /Seller/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('403: shows the refusal, keeps the edits on screen and allows another attempt', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build({ beforePut: () => { throw new ApiError(403, 'لا يمكنك منح صلاحياتٍ لا تملك حق تفويضها.', { message: 'لا يمكنك منح صلاحياتٍ لا تملك حق تفويضها.' }); } }));
    const dialog = await edit(user);
    await confirm(user, dialog);
    expect(await screen.findByText('You are not allowed to make this change')).toBeTruthy();
    expect(screen.getByText('Your edits are kept on screen and nothing was sent.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Supervisor/ }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('button', { name: /Review and save|No changes/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(world.staff.find((s) => s.user.id === EMP)!.template).toBe('seller');
  });

  it('404: the employee is gone — edits stay visible but cannot be saved, with a way back', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build({ beforePut: () => { throw new ApiError(404, 'not found', {}); } }));
    const dialog = await edit(user);
    await confirm(user, dialog);
    expect(await screen.findByText('Employee unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to staff' }).getAttribute('href')).toBe('/fuel-stations/ops/manage/staff');
    expect((screen.getByRole('button', { name: /Review and save|No changes/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('422: shows what the server said and keeps the edits', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build({ beforePut: () => { throw new ApiError(422, 'المحطة خارج فرع أو مستودع الموظف', { message: 'المحطة خارج فرع أو مستودع الموظف' }); } }));
    const dialog = await edit(user);
    await confirm(user, dialog);
    expect(await screen.findByText('The change could not be saved')).toBeTruthy();
    expect(screen.getByText(/المحطة خارج فرع/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Supervisor/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('lost response after sending: never re-sends blindly — checks the real state and confirms it was applied', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    connect(build({ dropResponseAfterApply: true }));
    const dialog = await edit(user);
    await confirm(user, dialog);
    expect(await screen.findByText('We could not confirm the save')).toBeTruthy();
    expect(world.puts).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(world.puts).toHaveLength(1); // لا إعادة إرسال
  });

  it('blocks a duplicate submit while saving', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    connect(build({ beforePut: () => undefined }));
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: never) => {
      if ((init as { method?: string } | undefined)?.method === 'PUT') await gate;
      return original(path, init as never);
    }) as never);
    const dialog = await edit(user);
    const button = within(dialog).getByRole('button', { name: 'Confirm and save' });
    await user.click(button);
    await user.click(within(dialog).getByRole('button', { name: 'Saving…' }));
    release();
    await waitFor(() => expect(world.puts).toHaveLength(1));
  });
});

describe('permissions reference', () => {
  it('lists templates, the reserved keys and how much the actor may delegate — read only', async () => {
    seedUser(ADMIN);
    connect(build());
    renderOps(<PermissionsScreen />);
    expect(await screen.findByText('Seller')).toBeTruthy();
    expect(screen.getByText('Reserved permissions')).toBeTruthy();
    expect(screen.getByText(/You can delegate \d+ of \d+ fuel permissions/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('audit log', () => {
  const events = [
    auditEvent('e1', { occurred_at: '2026-11-06T10:00:00+00:00' }),
    auditEvent('e2', {
      outcome: 'denied', actor: { id: 'u-mgr', name: 'Manager Mo' }, target: { kind: 'user', id: EMP, name: 'Emp One' }, denial_reason: '403: لا يمكنك منح صلاحياتٍ لا تملك حق تفويضها.',
      changes: [{ key: 'add_permissions', kind: 'list', added: ['fuel.governance.manage'], removed: [], count: 1 }],
    }),
    auditEvent('e3', { subject_type: 'role', action: 'role.updated', target: { kind: 'role', id: 'r1', name: 'Cashiers' }, changes: [{ key: 'name', kind: 'scalar', from: 'Old', to: 'Cashiers' }] }),
  ];

  it('renders who changed what, to whom, when and with what outcome — without raw snapshots or secrets', async () => {
    seedUser(ADMIN);
    connect(build({ audit: events }));
    renderOps(<AuditScreen />);
    await screen.findAllByText('Station staff permissions changed');
    const cards = screen.getAllByRole('listitem');
    const first = cards.find((li) => li.textContent?.includes('Admin One') && li.textContent?.includes('Station staff permissions changed')) as HTMLElement;
    expect(first.textContent).toContain('Emp One');
    expect(first.textContent).toContain('Applied');
    expect(first.textContent).toContain('+1');
    const denied = cards.find((li) => li.textContent?.includes('Manager Mo')) as HTMLElement;
    expect(denied.textContent).toContain('Refused');
    expect(denied.textContent).toContain('What was attempted:');
    expect(denied.textContent).toContain('403:');
    const role = cards.find((li) => li.textContent?.includes('Role updated')) as HTMLElement;
    expect(role.textContent).toContain('Cashiers');
    expect(role.textContent).toContain('from Old to Cashiers');
    expect(cards.filter((li) => li.textContent?.includes('Station staff') || li.textContent?.includes('Role updated')).map((li) => li.textContent).join(' ')).not.toMatch(/password|secret|\[redacted\]|@example\.test|token/i);
    expect(screen.getByText(/This log is read only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete|edit|remove/i })).toBeNull();
  });

  it('filters by outcome and pages on the server (page and filter go in the query, 20 per page)', async () => {
    const user = userEvent.setup();
    seedUser(ADMIN);
    const many = Array.from({ length: 45 }, (_, i) => auditEvent(`m${i}`, i % 3 === 0 ? { outcome: 'denied' } : {}));
    connect(build({ audit: many }));
    renderOps(<AuditScreen />);
    await screen.findByText('1 / 3');
    expect(world.gets.some((url) => url.includes('page=1') && url.includes('per_page=20'))).toBe(true);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('2 / 3');
    expect(world.gets.some((url) => url.includes('page=2'))).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Refused' }));
    await screen.findByText('1 / 1');
    expect(world.gets.some((url) => url.includes('outcome=denied') && url.includes('page=1'))).toBe(true);
  });

  it('shows a clear empty state and an error state with retry', async () => {
    seedUser(ADMIN);
    connect(build({ audit: [] }));
    renderOps(<AuditScreen />);
    expect(await screen.findByText('No events')).toBeTruthy();
    cleanup();
    connect(build());
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: never) => {
      if (String(path).startsWith('/fuel-stations/staff/audit')) throw new ApiError(500, 'boom', {});
      return original(path, init as never);
    }) as never);
    renderOps(<AuditScreen />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Arabic RTL and accessibility', () => {
  it('renders the editor in Arabic with logical (RTL-safe) layout and no accessibility violations', async () => {
    seedUser(ADMIN);
    connect(build());
    const { container } = renderOps(<StaffEditorScreen id={EMP} />, 'ar');
    await screen.findByRole('radiogroup');
    expect(screen.getByRole('radio', { name: /^بائع/ })).toBeTruthy();
    expect(screen.getByText('لا توجد تغييرات')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    expect((await axe(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });

  it('the staff list and audit have no accessibility violations', async () => {
    seedUser(ADMIN);
    connect(build({ audit: [auditEvent('e1')] }));
    const { container } = renderOps(<StaffListScreen />);
    await screen.findByRole('link', { name: /Emp One/ });
    expect((await axe(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});

describe('MANAGER template ceiling sanity', () => {
  it('fixtures stay aligned with the real catalogue shape', () => {
    expect(MANAGER.every((key) => CATALOG.includes(key))).toBe(true);
    expect(SELLER).toHaveLength(5);
  });
});
