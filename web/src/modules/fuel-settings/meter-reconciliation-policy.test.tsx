// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';
import { MeterReconciliationPolicy } from './meter-reconciliation-policy';

afterEach(cleanup);

const OPEN = { deploymentOpen: true, source: null } as const;
const CLOSED = { deploymentOpen: false, source: null } as const;

function mount(props: Partial<React.ComponentProps<typeof MeterReconciliationPolicy>> = {}, locale: 'ar' | 'en' = 'ar') {
  const onChange = vi.fn();
  const onInherit = vi.fn();
  const view = renderIntl(<MeterReconciliationPolicy checked={false} savedChecked={false} onChange={onChange} canEdit canGovern meta={OPEN} {...props} />, locale);
  return { onChange, onInherit, ...view };
}

const status = () => document.querySelector('[data-meter-reconciliation-status]')!;

describe('MeterReconciliationPolicy', () => {
  it.each(TEST_LOCALES)('shows the effective state separately from the choice (%s)', (locale) => {
    const t = TEST_MESSAGES[locale].fuelStationsSettings.meterReconciliation.status;
    const cases: Array<[boolean, typeof OPEN | typeof CLOSED | null, keyof typeof t]> = [
      [true, OPEN, 'active'], [true, CLOSED, 'pending_deployment'], [true, null, 'unknown_deployment'], [false, OPEN, 'disabled'], [false, CLOSED, 'disabled'],
    ];
    for (const [checked, meta, expected] of cases) {
      const { unmount } = mount({ checked, savedChecked: checked, meta }, locale);
      expect(status().getAttribute('data-meter-reconciliation-status')).toBe(expected);
      expect(status().textContent).toContain(t[expected].title);
      unmount();
    }
  });

  it('always states the close/approval/frozen/historical rules and the operational-only boundary', () => {
    mount({ checked: false });
    const notes = TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.notes;
    for (const text of Object.values(notes)) expect(document.body.textContent).toContain(text);
    expect(notes.closeAllowed).toContain('إغلاق الوردية مسموح');
  });

  it('derives the effective state from the SAVED value, never from an unsaved draft', () => {
    mount({ checked: true, savedChecked: false, meta: OPEN });
    expect(status().getAttribute('data-meter-reconciliation-status')).toBe('disabled');
    expect(document.querySelector('[data-meter-reconciliation-unsaved]')?.textContent).toContain(TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.unsaved);
    cleanup();
    mount({ checked: true, savedChecked: true, meta: OPEN });
    expect(document.querySelector('[data-meter-reconciliation-unsaved]')).toBeNull();
  });

  it('toggles through the switch and reports the new value', () => {
    const { onChange } = mount({ checked: false });
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('is read-only without the governance permission and explains why (the server stays the authority)', () => {
    const { onChange } = mount({ canGovern: false });
    const toggle = screen.getByRole('switch') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-meter-reconciliation-governance]')?.textContent).toContain(TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.governanceRequired);
  });

  it('is read-only without settings management and shows no governance hint', () => {
    mount({ canEdit: false, canGovern: true });
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-meter-reconciliation-governance]')).toBeNull();
  });

  it('offers inheritance only at station scope, enabled only for governors, and names the value source', () => {
    const none = mount();
    expect(screen.queryByText(TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.useInherited)).toBeNull();
    none.unmount();

    const onInherit = vi.fn();
    renderIntl(<MeterReconciliationPolicy checked savedChecked canEdit canGovern meta={{ deploymentOpen: true, source: 'station' }} onChange={vi.fn()} onInherit={onInherit} />, 'ar');
    fireEvent.click(screen.getByText(TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.useInherited));
    expect(onInherit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-meter-reconciliation-source="station"]')?.textContent).toContain(TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.source.station);
    cleanup();

    renderIntl(<MeterReconciliationPolicy checked savedChecked canEdit canGovern={false} meta={OPEN} onChange={vi.fn()} onInherit={vi.fn()} />, 'ar');
    expect((screen.getByText(TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation.useInherited).closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('meterReconciliation messages and layout', () => {
  const flatten = (value: unknown, prefix = ''): string[] => (typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, inner]) => flatten(inner, `${prefix}${key}.`))
    : [prefix.slice(0, -1)]);

  it('has the same keys in Arabic and English and no empty text', () => {
    const ar = TEST_MESSAGES.ar.fuelStationsSettings.meterReconciliation;
    const en = TEST_MESSAGES.en.fuelStationsSettings.meterReconciliation;
    expect(flatten(ar).sort()).toEqual(flatten(en).sort());
    for (const text of [...Object.values(ar.notes), ...Object.values(en.notes), ar.title, en.title]) expect(text.trim().length).toBeGreaterThan(5);
  });

  it('uses logical direction classes only (RTL/LTR safe)', () => {
    const dir = join(process.cwd(), 'src/modules/fuel-settings');
    const physical = /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r|rounded-l|rounded-r|float-left|float-right)-/;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))) {
      const classNames = [...readFileSync(join(dir, file), 'utf8').matchAll(/className="([^"]*)"/g)].map((match) => match[1]).join(' ');
      expect(classNames, `${file} uses a physical direction class`).not.toMatch(physical);
    }
  });

  it('never calls the network or writes anything itself (the page owns the single settings PUT)', () => {
    const source = readFileSync(join(process.cwd(), 'src/modules/fuel-settings/meter-reconciliation-policy.tsx'), 'utf8');
    expect(source).not.toMatch(/@\/lib\/api|fetch\(|method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });
});
