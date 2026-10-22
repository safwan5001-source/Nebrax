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

describe('KpiCard unavailable state (TREASURY-T2)', () => {
  it('shows a dash and the reason instead of a misleading zero, with no unit or sparkline', () => {
    render(<KpiCard label="Cash" value="0" unit="SAR" icon={Wallet} trend={[1, 2, 3]} unavailable="Balance unavailable" />);
    expect(screen.getByText('Balance unavailable')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Balance unavailable');
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('SAR')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('still renders a genuine zero balance as a number', () => {
    render(<KpiCard label="Cash" value="0" unit="SAR" icon={Wallet} />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('loading wins over unavailable', () => {
    render(<KpiCard label="Cash" value="0" icon={Wallet} loading unavailable="Balance unavailable" />);
    expect(screen.queryByText('Balance unavailable')).toBeNull();
  });
});
