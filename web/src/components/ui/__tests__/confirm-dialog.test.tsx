// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmProvider, useConfirm, type ConfirmOptions } from '../confirm-dialog';
import { renderIntl } from '@/test-utils/intl';

beforeAll(() => {
  // jsdom has no layout; the dialog only cycles focus through visible elements.
  HTMLElement.prototype.getClientRects = function getClientRects() {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

function Harness({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm();
  const [result, setResult] = useState('pending');
  return (
    <>
      <button type="button" onClick={async () => setResult(String(await confirm(options)))}>delete row</button>
      <output>{result}</output>
    </>
  );
}

function open(options: ConfirmOptions, locale: 'ar' | 'en' = 'en') {
  renderIntl(<ConfirmProvider><Harness options={options} /></ConfirmProvider>, locale);
  const trigger = screen.getByRole('button', { name: 'delete row' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe('ConfirmProvider (ERP-UX-017)', () => {
  it('asks in an in-app dialog and resolves true on confirm', async () => {
    open({ message: 'Delete this expense?', tone: 'danger' });
    const dialog = screen.getByRole('dialog', { name: 'Confirm action' });
    expect(dialog.textContent).toContain('Delete this expense?');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
    expect(screen.getByText('true')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focuses Cancel first so Enter does not run a destructive action', () => {
    open({ message: 'Delete?', tone: 'danger' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Confirm' }).className).toContain('bg-negative');
  });

  it('resolves false on Cancel, on Escape, and returns focus to the trigger', async () => {
    const trigger = open({ message: 'Post this voucher?' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(screen.getByText('false')).toBeTruthy();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    await act(async () => { fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('false')).toBeTruthy();
  });

  it('uses a primary button for non-destructive actions and honours a custom label', () => {
    open({ message: 'Post?', confirmLabel: 'Post now' });
    expect(screen.getByRole('button', { name: 'Post now' }).className).not.toContain('bg-negative');
  });

  it('labels the dialog in Arabic', () => {
    open({ message: 'حذف؟' }, 'ar');
    expect(screen.getByRole('dialog', { name: 'تأكيد الإجراء' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'تأكيد' })).toBeTruthy();
  });

  it('falls back to window.confirm outside the provider (isolated component tests)', async () => {
    const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Harness options={{ message: 'Delete?' }} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'delete row' })); });
    expect(native).toHaveBeenCalledWith('Delete?');
    expect(screen.getByText('true')).toBeTruthy();
  });
});

describe('Converted modules no longer use the native confirm (ERP-UX-H1-6B)', () => {
  const SRC = resolve(__dirname, '../../..');
  const CONVERTED = [
    'app/(app)/cash-and-bank', 'app/(app)/cost-centers', 'app/(app)/hr', 'app/(app)/manual-journals',
    'app/(app)/employee-custodies', 'app/(app)/expenses', 'app/(app)/payment-methods',
    'app/(app)/finance-settings', 'app/(app)/receipt-vouchers', 'app/(app)/accounting-settings', 'components/hr',
  ];
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });

  it('has no window.confirm / confirm( in finance, accounting and HR screens', () => {
    const offenders = CONVERTED.flatMap((dir) => files(join(SRC, dir)))
      .filter((file) => /(?<![\w.])(window\.)?confirm\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
