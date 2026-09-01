import { describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';

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
});
