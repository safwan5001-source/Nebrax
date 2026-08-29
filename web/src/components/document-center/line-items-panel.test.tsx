// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineItemsPanel } from './line-items-panel';
import type { ReviewLine } from '@/modules/document-center/contract';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const line: ReviewLine = {
  index: 0,
  description: 'Widget',
  confidence_basis_points: 9000,
  product_match_id: null,
  unit_match_id: null,
  fields: [
    { key: 'quantity', current: 2, original: 2, editable: true },
    { key: 'unit_price_minor', current: 1000, original: 1000, editable: true },
    { key: 'discount_minor', current: 50, original: 50, editable: true },
    { key: 'tax_amount_minor', current: 150, original: 150, editable: true },
    { key: 'total_minor', current: 2100, original: 2100, editable: true },
    { key: 'sku', current: 'SKU-1', original: 'SKU-1', editable: false },
  ],
};

describe('LineItemsPanel desktop edits', () => {
  afterEach(() => {
    cleanup();
  });

  it('exposes discount and tax edit controls in the desktop table row', () => {
    const onEdit = vi.fn();

    const { container } = render(<LineItemsPanel lines={[line]} canEdit onEdit={onEdit} />);

    const tableButtons = Array.from(container.querySelectorAll('table button'));
    const labels = tableButtons.map((button) => button.textContent);

    expect(labels).toContain('lineDiscount');
    expect(labels).toContain('lineTax');
    expect(labels).toContain('lineQuantity');
    expect(labels).toContain('lineUnitPrice');
    expect(labels).toContain('lineTotal');

    fireEvent.click(screen.getByRole('button', { name: 'lineDiscount' }));
    expect(onEdit).toHaveBeenCalledWith({
      targetKey: 'lines.0.discount_minor',
      fieldLabel: 'lineDiscount',
      value: 50,
    });
  });
});
