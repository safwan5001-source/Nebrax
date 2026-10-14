// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Wallet } from 'lucide-react';
import { KpiCard } from './kpi-card';

afterEach(cleanup);

describe('KpiCard at phone widths (ERP-UX-024)', () => {
  it('sizes the amount to the card on phones without changing or truncating its text', () => {
    render(<KpiCard label="Performance" value="-1,234,567.89" unit="𞸁" icon={Wallet} sub={{ label: 'Net after expenses', value: '-10,471.5 𞸁', tone: 'negative' }} />);
    // The value text sits in an LTR isolate (`<bdi>`, ERP-UX-027); the sizing classes are on its container.
    const amount = screen.getByText('-1,234,567.89').closest('[class*="clamp"]') as HTMLElement;
    expect(amount).not.toBeNull();
    expect(amount.className).toContain('text-[length:clamp(14px,12.5cqi,21px)]');
    expect(amount.className).toContain('sm:text-[26px]');
    expect(amount.className).not.toMatch(/truncate|text-ellipsis/);
    // The card is the size container the amount scales against.
    expect(amount.closest('[class*="container-type"]')).not.toBeNull();
  });

  it('lets the secondary amount wrap under its label instead of spilling out', () => {
    render(<KpiCard label="Performance" value="3,028.5" icon={Wallet} sub={{ label: 'Net after expenses', value: '-10,471.5 𞸁', tone: 'negative' }} />);
    const row = screen.getByText('Net after expenses').parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(screen.getByText('-10,471.5 𞸁')).toBeTruthy();
  });
});
