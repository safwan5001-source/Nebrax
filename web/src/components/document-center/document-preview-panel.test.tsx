// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentPreviewPanel } from './document-preview-panel';

const { apiMock, fetchPrivateFileUrlMock, translate } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  fetchPrivateFileUrlMock: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
  fetchPrivateFileUrl: fetchPrivateFileUrlMock,
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
  beforeEach(() => {
    apiMock.mockReset();
    fetchPrivateFileUrlMock.mockReset();
  });

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
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('shows empty state without file', () => {
    render(<DocumentPreviewPanel file={null} />);
    expect(screen.getByText('noPreview')).toBeTruthy();
  });

  it('fetches a private PDF with the authenticated file helper and renders the blob URL', async () => {
    apiMock.mockResolvedValue({ url: 'https://api.example.test/api/document-files/f1/download?signature=signed' });
    fetchPrivateFileUrlMock.mockResolvedValue('blob:https://app.example.test/pdf');

    render(<DocumentPreviewPanel file={{ id: 'f1', original_name: 'invoice.pdf', mime_type: 'application/pdf', page_count: 3, download_available: true }} />);

    await waitFor(() => expect(screen.getByTitle('invoice.pdf').getAttribute('src')).toBe('blob:https://app.example.test/pdf'));
    expect(fetchPrivateFileUrlMock).toHaveBeenCalledWith(
      'https://api.example.test/api/document-files/f1/download?signature=signed',
      'application/pdf',
    );
    expect(screen.getByText('page')).toBeTruthy();
  });

  it('shows a retryable error and never mounts an iframe when the protected response is invalid JSON', async () => {
    apiMock.mockResolvedValue({ url: 'https://api.example.test/api/document-files/f1/download?signature=signed' });
    fetchPrivateFileUrlMock.mockRejectedValue(new Error('preview_invalid_response'));

    render(<DocumentPreviewPanel file={{ id: 'f1', original_name: 'invoice.pdf', mime_type: 'application/pdf', page_count: 1, download_available: true }} />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('unavailable'));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });

  it('retries the authenticated request after a transient network failure', async () => {
    apiMock
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ url: 'https://api.example.test/api/document-files/f1/download?signature=signed' });
    fetchPrivateFileUrlMock.mockResolvedValue('blob:https://app.example.test/pdf');

    render(<DocumentPreviewPanel file={{ id: 'f1', original_name: 'invoice.pdf', mime_type: 'application/pdf', page_count: 1, download_available: true }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy());
    screen.getByRole('button', { name: 'retry' }).click();
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('shows the approved scan-exception disclosure instead of the generic processing message when the file was exception-admitted', () => {
    render(
      <DocumentPreviewPanel
        file={{ id: 'f1', original_name: 'delivery-note.pdf', mime_type: 'application/pdf', page_count: 1, download_available: false }}
        scanStatus="pending"
        processingMessage="needs_review"
        scanExceptionAdmitted
      />,
    );
    expect(screen.getByText('scanExceptionNotice')).toBeTruthy();
    expect(screen.queryByText('needs_review')).toBeNull();
  });

  it('keeps showing the raw processing message when the file was not exception-admitted', () => {
    render(
      <DocumentPreviewPanel
        file={{ id: 'f1', original_name: 'invoice.pdf', mime_type: 'application/pdf', page_count: 1, download_available: false }}
        scanStatus="pending"
        processingMessage="scan pending"
        scanExceptionAdmitted={false}
      />,
    );
    expect(screen.getByText('scan pending')).toBeTruthy();
    expect(screen.queryByText('scanExceptionNotice')).toBeNull();
  });
});
