// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentUploadDialog } from './document-upload-dialog';

const { runIntake } = vi.hoisted(() => ({ runIntake: vi.fn() }));

vi.mock('@/lib/document-intake', () => ({ runIntake }));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key },
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
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

describe('DocumentUploadDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    runIntake.mockReset();
  });

  it('يعرض اختيار الملفات ويسمح بإزالتها قبل الإرسال', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(<DocumentUploadDialog open onClose={onClose} onSuccess={onSuccess} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'invoice.pdf', { type: 'application/pdf' });
    await user.upload(input, file);

    expect(screen.getByText('invoice.pdf')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'removeFile:invoice.pdf' }));
    expect(screen.queryByText('invoice.pdf')).toBeNull();
  });

  it('ينجح الرفع ويعرض روابط المتابعة', async () => {
    const user = userEvent.setup();
    runIntake.mockResolvedValue({ id: 'batch-99', status: 'received' });

    render(<DocumentUploadDialog open onClose={vi.fn()} onSuccess={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'invoice.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(runIntake).toHaveBeenCalled();
      expect(screen.getByText('uploadSuccess')).toBeTruthy();
      expect(screen.getByRole('link', { name: 'viewBatch' }).getAttribute('href')).toBe('/documents/batch-99');
      expect(screen.getByRole('link', { name: 'viewDiagnostics' }).getAttribute('href')).toBe('/documents/batch-99/diagnostics');
    });
  });

  it('يعرض خطأ عند فشل الرفع', async () => {
    const user = userEvent.setup();
    runIntake.mockRejectedValue(new Error('boom'));

    render(<DocumentUploadDialog open onClose={vi.fn()} onSuccess={vi.fn()} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'invoice.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(screen.getByText('uploadFailed')).toBeTruthy();
    });
  });
});
