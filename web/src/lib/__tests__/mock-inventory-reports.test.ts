import { describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';

describe('بيانات العرض لتقارير المخزون', () => {
  it('تعيد لقطة القيمة وأرصدة المخازن بعقود منفصلة للقيمة والكمية', async () => {
    const value = await mockApi<{ data: Array<{ quantity: number; avg_cost: string; stock_value: string }>; totals: { products: number; stock_value: string }; scope: { source: string; snapshot: boolean } }>('/reports/inventory?view=value');
    const warehouses = await mockApi<{ data: Array<{ warehouse: string; quantity: number; stock_value?: string }>; totals: { warehouses: number; quantity: number }; scope: { source: string; snapshot: boolean } }>('/reports/inventory?view=warehouses');

    expect(value.scope).toEqual({ source: 'current_tracked_products', snapshot: true });
    expect(value.data[0]).toMatchObject({ quantity: expect.any(Number), avg_cost: expect.any(String), stock_value: expect.any(String) });
    expect(value.totals).toMatchObject({ products: expect.any(Number), stock_value: expect.any(String) });
    expect(warehouses.scope).toEqual({ source: 'warehouse_stock_quantities', snapshot: true });
    expect(warehouses.data[0]).toMatchObject({ warehouse: expect.any(String), quantity: expect.any(Number) });
    expect(warehouses.data[0]).not.toHaveProperty('stock_value');
  });

  it('تعيد الحركات والأذون والجرد بمصادر مرحّلة وبفروق جرد موقعة', async () => {
    const movements = await mockApi<{ data: Array<{ type: string; unit_cost: string; balance_quantity: number }>; totals: { in_quantity: number; out_quantity: number }; scope: { source: string; snapshot: boolean } }>('/reports/inventory?view=movements');
    const operations = await mockApi<{ data: Array<{ type: string; number: string; total_cost: string }>; scope: { source: string; snapshot: boolean } }>('/reports/inventory?view=operations');
    const stocktakes = await mockApi<{ data: Array<{ counted_lines: number; quantity_difference: number; difference_value: string }>; totals: { difference_value: string }; scope: { source: string; snapshot: boolean } }>('/reports/inventory?view=stocktakes');

    expect(movements.scope).toEqual({ source: 'posted_stock_movements', snapshot: false });
    expect(movements.data[0]).toMatchObject({ type: expect.any(String), unit_cost: expect.any(String), balance_quantity: expect.any(Number) });
    expect(movements.totals.in_quantity - movements.totals.out_quantity).toBe(22);
    expect(operations.scope).toEqual({ source: 'posted_stock_permits', snapshot: false });
    expect(operations.data[0]).toMatchObject({ type: 'transfer', number: expect.any(String), total_cost: expect.any(String) });
    expect(stocktakes.scope).toEqual({ source: 'posted_stocktakes', snapshot: false });
    expect(stocktakes.data[0]).toMatchObject({ counted_lines: expect.any(Number), quantity_difference: expect.any(Number), difference_value: expect.any(String) });
    expect(stocktakes.totals.difference_value).toMatch(/^-/);
  });
});
