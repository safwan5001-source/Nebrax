// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentPreviewPanel } from './document-preview-panel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/api', () => ({
  api: vi.fn().mockRejectedValue(new Error('demo')),
  ApiError: class ApiError extends Error {},
}));

vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

describe('DocumentPreviewPanel', () => {
  afterEach(() => cleanup());

  it('shows unavailable state when download is blocked', () => {
    render(
      <DocumentPreviewPanel
        file={{ id: 'f1', original_name: 'invoice.pdf', mime_type: 'application/pdf', page_count: 1, download_available: false }}
        scanStatus="pending"
        processingMessage="scan pending"
      />,
    );
    expect(screen.getByText('previewUnavailable')).toBeTruthy();
  });

  it('shows empty state without file', () => {
    render(<DocumentPreviewPanel file={null} />);
    expect(screen.getByText('noPreview')).toBeTruthy();
  });
});
