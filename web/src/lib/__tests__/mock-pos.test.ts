import { describe, expect, it } from 'vitest';
import { mockApi, mockPosSessions } from '@/lib/mock-data';

describe('POS demo contracts', () => {
  it('provides a sellable POS catalogue instead of an empty demo state', async () => {
    const response = await mockApi<{ data: Array<{
      id: string;
      pos_units: Array<{ name: string; factor: number; price: string }>;
      pos_barcodes: Array<{ code: string; unit_name: string; default_quantity: number }>;
      is_active: boolean;
    }> }>('/pos/products');

    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data.every((product) => product.is_active)).toBe(true);
    expect(response.data[0]?.pos_units[0]).toMatchObject({ factor: 1 });
  });

  it('provides recent posted invoices for visual verification', async () => {
    const response = await mockApi<{ data: Array<{
      id: string;
      number: string;
      status: string;
      payment_methods: string[];
    }> }>('/pos/recent-invoices?limit=20');

    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data.every((invoice) => invoice.status === 'posted')).toBe(true);
    expect(response.data[0]?.number).toMatch(/^INV-/);
  });

  it('exposes explicit POS image, payment, and drawer defaults', async () => {
    const response = await mockApi<{ data: {
      show_product_images: boolean;
      payment_methods_mode: string;
      cash_drawer_enabled: boolean;
      cash_drawer_driver: string;
      sound_enabled: boolean;
      scan_sound_enabled: boolean;
      error_sound_enabled: boolean;
      payment_sound_enabled: boolean;
      sound_volume: number;
      haptics_enabled: boolean;
    } }>('/sales-config/pos');

    expect(response.data).toMatchObject({
      show_product_images: true,
      payment_methods_mode: 'all_active',
      cash_drawer_enabled: false,
      cash_drawer_driver: 'unavailable',
      sound_enabled: true,
      scan_sound_enabled: true,
      error_sound_enabled: true,
      payment_sound_enabled: true,
      sound_volume: 60,
      haptics_enabled: true,
    });
  });

  it('provides the reconciliation contract used by the session close dialog', async () => {
    const response = await mockApi<{ data: {
      cash_drawer: { reconciliation_key: string; expected_amount: string | null };
      payment_methods: Array<{ payment_method_id: string | null; expected_amount: string | null }>;
    } }>('/pos-sessions/ps-2/closing-preview');

    expect(response.data.cash_drawer).toMatchObject({
      reconciliation_key: 'cash_drawer',
      expected_amount: '500.00',
    });
    expect(response.data.payment_methods).toEqual([
      expect.objectContaining({ payment_method_id: 'pm-method-bank', expected_amount: '650.00' }),
    ]);
  });

  it('does not reveal expected amounts while blind count is enabled', async () => {
    await mockApi('/sales-config/pos', 'PUT', { data: { blind_cash_count_enabled: true } });

    try {
      const response = await mockApi<{ data: {
        cash_drawer: { expected_amount: string | null };
        payment_methods: Array<{ expected_amount: string | null }>;
      } }>('/pos-sessions/ps-2/closing-preview');

      expect(response.data.cash_drawer.expected_amount).toBeNull();
      expect(response.data.payment_methods.every((method) => method.expected_amount === null)).toBe(true);
    } finally {
      await mockApi('/sales-config/pos', 'PUT', { data: { blind_cash_count_enabled: false } });
    }
  });

  it('provides the complete session detail workspace contract', async () => {
    const response = await mockApi<{ data: {
      id: string;
      pos_device: { name: string };
      reconciliations: Array<{ reconciliation_key: string; expected_amount: string }>;
    } }>('/pos-sessions/ps-1');

    expect(response.data.id).toBe('ps-1');
    expect(response.data.pos_device.name).toBeTruthy();
    expect(response.data.reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({ reconciliation_key: 'cash_drawer', expected_amount: '4380.00' }),
    ]));
  });

  it('filters the demo session register with the server query contract', async () => {
    const response = await mockApi<{ data: Array<{ id: string }>; meta: { summary: { total_count: number; open_count: number; handover_confirmed_count: number }; filters: { devices: unknown[]; shifts: unknown[] } } }>('/pos-sessions?status=closed&handover_status=confirmed&difference_status=not_required&pos_device_id=pd-2&pos_shift_id=pos-shift-evening&date_from=2026-06-27&date_to=2026-06-27');

    expect(response.data).toEqual([{ id: 'ps-1' }].map(({ id }) => expect.objectContaining({ id })));
    expect(response.meta.filters.devices).toHaveLength(2);
    expect(response.meta.filters.shifts).toHaveLength(2);
    expect(response.meta.summary).toMatchObject({ total_count: 2, open_count: 1, handover_confirmed_count: 1 });
  });

  it('keeps report sales tied to the selected demo session', async () => {
    const closed = await mockApi<{ session: { id: string }; report: { sales_count: number; returns_count: number }; sales: Array<{ id: string }>; returns: Array<{ id: string }> }>('/pos-sessions/ps-1/report');
    const open = await mockApi<{ session: { id: string }; report: { sales_count: number; returns_count: number }; sales: Array<{ id: string }>; returns: Array<{ id: string }> }>('/pos-sessions/ps-2/report');

    expect(closed.session.id).toBe('ps-1');
    expect(closed.sales).toHaveLength(closed.report.sales_count);
    expect(closed.returns).toHaveLength(closed.report.returns_count);
    expect(open.session.id).toBe('ps-2');
    expect(open.sales).toHaveLength(open.report.sales_count);
    expect(open.returns).toHaveLength(open.report.returns_count);
    expect(open.sales.map((sale) => sale.id)).not.toEqual(closed.sales.map((sale) => sale.id));
  });

  it('opens a demo POS session with pos_shift_id and minor-unit opening_balance', async () => {
    const previouslyOpen = mockPosSessions.find((session) => session.status === 'open');
    if (previouslyOpen) previouslyOpen.status = 'closed';
    try {
      const created = await mockApi<{ data: {
        pos_shift_id: string | null;
        shift_id: string | null;
        opening_balance: string;
        pos_device_id: string;
      } }>('/pos-sessions/open', 'POST', {
        opening_balance: 0,
        pos_device_id: 'pd-1',
        pos_shift_id: 'pos-shift-morning',
      });
      expect(created.data).toMatchObject({
        pos_device_id: 'pd-1',
        pos_shift_id: 'pos-shift-morning',
        shift_id: null,
        opening_balance: '0.00',
      });
    } finally {
      if (previouslyOpen) previouslyOpen.status = 'open';
    }
  });

  it('rejects an inactive demo POS device on open like the backend would', async () => {
    await expect(mockApi('/pos-sessions/open', 'POST', {
      opening_balance: 0,
      pos_device_id: 'pd-2',
      pos_shift_id: 'pos-shift-morning',
    })).rejects.toMatchObject({ status: 422 });
  });
});
