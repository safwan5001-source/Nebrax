// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtractedFieldsPanel } from './extracted-fields-panel';
import type { ReviewField } from '@/modules/document-center/contract';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-testid="confidence-badge">{children}</span>,
}));

describe('ExtractedFieldsPanel confidence rendering', () => {
  afterEach(() => cleanup());

  it('never shows a confidence badge for a field without real evidence confidence', () => {
    const fields: ReviewField[] = [
      { key: 'recipient_tax_number', original: null, current: null },
      { key: 'external_reference', original: null, current: null },
    ];

    render(<ExtractedFieldsPanel fields={fields} canEdit={false} onEdit={vi.fn()} />);

    expect(screen.queryByTestId('confidence-badge')).toBeNull();
  });

  it('shows the real confidence badge when the backend provides one', () => {
    const fields: ReviewField[] = [
      { key: 'issuer_name', original: 'مورد تجريبي', current: 'مورد تجريبي', confidence_basis_points: 6500 },
    ];

    render(<ExtractedFieldsPanel fields={fields} canEdit={false} onEdit={vi.fn()} />);

    expect(screen.getByTestId('confidence-badge').textContent).toContain('65');
  });
});
