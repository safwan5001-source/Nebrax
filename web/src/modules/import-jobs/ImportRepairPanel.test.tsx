// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ar from '@/messages/ar.json';
import { ImportRepairPanel } from './ImportRepairPanel';
import type { ImportJob } from './client';

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    domain: 'product_catalog',
    status: 'failed',
    original_filename: 'catalog.csv',
    extension: 'csv',
    byte_size: 1,
    content_sha256: 'a',
    media_archive: null,
    row_count: 250,
    column_count: 5,
    processed_rows: 100,
    apply_result: null,
    error_message: 'x',
    created_by: null,
    cancelled_by: null,
    cancelled_at: null,
    purge_after: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    failed_units: 150,
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof ImportRepairPanel>> = {}) {
  const onDownload = vi.fn();
  const onRepair = vi.fn();
  render(
    <NextIntlClientProvider locale="ar" messages={{ importJobs: ar.importJobs }}>
      <ImportRepairPanel job={job()} busy={false} onDownload={onDownload} onRepair={onRepair} {...props} />
    </NextIntlClientProvider>
  );

  return { onDownload, onRepair };
}

afterEach(cleanup);

describe('ImportRepairPanel (IMP-H1-S8c)', () => {
  it('shows the failed count and offers download and upload for a failed job with repairable units', () => {
    renderPanel();

    expect(screen.getByText(/لم تُطبَّق 150 من صفوف/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /تنزيل الصفوف الفاشلة/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /رفع الملف المصحَّح/ })).toBeTruthy();
  });

  it('renders nothing unless the job is failed AND the server reported repairable units', () => {
    for (const overrides of [{ status: 'completed' as const }, { failed_units: 0 }, { failed_units: undefined }, { status: 'processing' as const }]) {
      const { container } = render(
        <NextIntlClientProvider locale="ar" messages={{ importJobs: ar.importJobs }}>
          <ImportRepairPanel job={job(overrides)} busy={false} onDownload={() => {}} onRepair={() => {}} />
        </NextIntlClientProvider>
      );
      expect(container.querySelector('section')).toBeNull();
      cleanup();
    }
  });

  it('download calls the handler; choosing a file hands it to the repair handler once', () => {
    const { onDownload, onRepair } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /تنزيل الصفوف الفاشلة/ }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    const file = new File(['x'], 'fixed.xlsx');
    fireEvent.change(screen.getByTestId('repair-file'), { target: { files: [file] } });
    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(onRepair).toHaveBeenCalledWith(file);
  });

  it('disables both actions while a request is running', () => {
    renderPanel({ busy: true });

    expect((screen.getByRole('button', { name: /تنزيل الصفوف الفاشلة/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /رفع الملف المصحَّح/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
