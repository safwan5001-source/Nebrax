import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('POS session register controls', () => {
  it('sends operational filters to the branch-scoped register endpoint', () => {
    const page = source('src/app/(app)/pos/sessions/page.tsx');

    expect(page).toContain("params.set('status', statusFilter)");
    expect(page).toContain("params.set('handover_status', handoverStatusFilter)");
    expect(page).toContain("params.set('difference_status', differenceStatusFilter)");
    expect(page).toContain("params.set('pos_device_id', deviceFilter)");
    expect(page).toContain("params.set('pos_shift_id', shiftFilter)");
    expect(page).toContain("params.set('date_from', dateFrom)");
    expect(page).toContain("params.set('date_to', dateTo)");
    expect(page).toContain('router.replace(registerQuery');
    expect(page).toContain('requestId !== registerRequestId.current');
    expect(page).toContain('requestId === registerRequestId.current');
    expect(page).toContain('r.meta?.summary');
    expect(page).toContain("applyQueueView(item.id as 'open' | 'handover_pending' | 'difference_pending' | 'handover_confirmed')");
  });

  it('keeps inactive historical device and shift values filterable but not selectable for opening', () => {
    const page = source('src/app/(app)/pos/sessions/page.tsx');

    expect(page).toContain('filterDevices.map((device)');
    expect(page).toContain('filterShifts.map((shift)');
    expect(page).toContain('activeDevices.map((device)');
    expect(page).toContain('activeShifts.map((shift)');
  });

  it('uses dense design tokens without decorative colors', () => {
    const page = source('src/app/(app)/pos/sessions/page.tsx');

    expect(page).toContain('border-border');
    expect(page).toContain('bg-surface');
    expect(page).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(page).not.toContain('gradient');
  });
});
