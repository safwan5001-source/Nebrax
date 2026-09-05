// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadinessGapsPanel } from './readiness-gaps-panel';
import type { ReviewField } from '@/modules/document-center/contract';

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

describe('ReadinessGapsPanel', () => {
  afterEach(() => cleanup());

  it('renders nothing when there are no gaps', () => {
    const { container } = render(<ReadinessGapsPanel gaps={[]} fields={[]} canEdit onEdit={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows every gap and lets an editable one open the field editor with its current value', () => {
    const fields: ReviewField[] = [{ key: 'recipient_name', original: null, current: null }];
    const onEdit = vi.fn();
    render(
      <ReadinessGapsPanel
        gaps={[
          { code: 'delivery_note_customer_missing', target_key: 'fields.recipient_name' },
          { code: 'delivery_note_quantity_missing', target_key: null },
        ]}
        fields={fields}
        canEdit
        onEdit={onEdit}
      />,
    );

    expect(screen.getByText('readinessGap_delivery_note_customer_missing')).toBeTruthy();
    expect(screen.getByText('readinessGap_delivery_note_quantity_missing')).toBeTruthy();
    // فجوة الكمية بلا target_key محدَّد — لا زر تعديل مباشر لها.
    expect(screen.getAllByText('readinessGapEdit')).toHaveLength(1);

    fireEvent.click(screen.getByText('readinessGapEdit'));
    expect(onEdit).toHaveBeenCalledWith({ fieldLabel: 'fieldRecipientName', targetKey: 'fields.recipient_name', value: null });
  });

  it('never shows an edit action when the reviewer cannot mutate the review', () => {
    render(
      <ReadinessGapsPanel
        gaps={[{ code: 'delivery_note_document_number_missing', target_key: 'fields.document_number' }]}
        fields={[]}
        canEdit={false}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.queryByText('readinessGapEdit')).toBeNull();
  });
});
