'use client';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptDialog, type Receipt } from './receipt-dialog';

const { printDocument, documentView } = vi.hoisted(() => ({
  printDocument: vi.fn(),
  documentView: vi.fn(({ templateId, themeId, showLogo }: { templateId: string; themeId?: string; showLogo?: boolean }) => (
    <div data-show-logo={String(showLogo)} data-template-id={templateId} data-theme-id={themeId ?? ''} />
  )),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/pos/pos-dialog', () => ({ Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, PosDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button> }));
vi.mock('@/modules/documents/components/document-view', () => ({ DocumentView: documentView }));
vi.mock('@/modules/documents/components/document-scaler', () => ({ DocumentScaler: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/modules/documents/services/export', () => ({ printDocument }));

function receipt(templateId: string): Receipt {
  return {
    model: {} as Receipt['model'],
    number: 'POS-2026-0001',
    thermalTemplateRevision: {
      id: 'thermal-revision-1',
      definition: {
        template_id: templateId,
        theme_id: 'black',
        show_logo: false,
        layout: [
          { key: 'header', visible: true },
          { key: 'parties', visible: true },
          { key: 'items', visible: true },
          { key: 'summary', visible: true },
          { key: 'footer', visible: true },
        ],
      },
    },
  };
}

describe('ReceiptDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('uses the frozen thermal revision for both preview and auto/manual print', () => {
    vi.useFakeTimers();
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} autoPrint paperSize="thermal_80" onClose={() => undefined} />);

    expect(documentView.mock.calls.at(-1)?.[0]).toMatchObject({
      templateId: 'tax-invoice-thermal80',
      themeId: 'black',
      showLogo: false,
      rootId: 'print-root',
    });

    act(() => { vi.advanceTimersByTime(300); });
    expect(printDocument).toHaveBeenCalledWith({ widthMm: 80, heightMm: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(printDocument).toHaveBeenLastCalledWith({ widthMm: 80, heightMm: 0 });
  });

  it('keeps the selected paper-size fallback when a frozen revision is incompatible', () => {
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} paperSize="thermal_58" onClose={() => undefined} />);

    expect(documentView.mock.calls.at(-1)?.[0]).toMatchObject({
      templateId: 'tax-invoice-thermal58',
      rootId: 'print-root',
    });

    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(printDocument).toHaveBeenCalledWith({ widthMm: 58, heightMm: 0 });
  });
});
