// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import ar from '@/messages/ar.json';
import { ImportJobStatusPanel } from './ImportJobStatusPanel';
import type { ImportJob } from './client';

const base: ImportJob = {
  id: 'child-1',
  domain: 'product_catalog',
  status: 'failed',
  original_filename: 'fixed.xlsx',
  extension: 'xlsx',
  byte_size: 1,
  content_sha256: 'a',
  media_archive: null,
  row_count: 10,
  column_count: 5,
  processed_rows: 0,
  apply_result: null,
  error_message: null,
  created_by: null,
  cancelled_by: null,
  cancelled_at: null,
  purge_after: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

afterEach(cleanup);

function renderPanel(job: ImportJob, onOpenParent?: (id: string) => void) {
  render(
    <NextIntlClientProvider locale="ar" messages={{ importJobs: ar.importJobs }}>
      <ImportJobStatusPanel job={job} atomic={false} onOpenParent={onOpenParent} />
    </NextIntlClientProvider>
  );
}

describe('ImportJobStatusPanel repair child (IMP-H1-S8c)', () => {
  it('labels a repair run and lets the user return to the original run, whose untouched units stay there', () => {
    const onOpenParent = vi.fn();
    renderPanel({ ...base, parent_job_id: 'parent-1' }, onOpenParent);

    expect(screen.getByText('تشغيلة إصلاح')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'عرض التشغيلة الأصلية' }));
    expect(onOpenParent).toHaveBeenCalledWith('parent-1');
  });

  it('shows neither the label nor the link for an ordinary run', () => {
    renderPanel({ ...base, parent_job_id: null }, vi.fn());

    expect(screen.queryByText('تشغيلة إصلاح')).toBeNull();
    expect(screen.queryByRole('button', { name: 'عرض التشغيلة الأصلية' })).toBeNull();
  });
});
