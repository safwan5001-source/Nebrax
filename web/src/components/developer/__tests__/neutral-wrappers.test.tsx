// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/developer/confirm-dialog';
import { SecretRevealDialog } from '@/components/developer/secret-reveal';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/**
 * INT-UX-5a — توافق خلفي: المكوّنان في `components/developer/*` أغلفة على المحايدين لكن مظهرهما وخاصياتهما
 * وترجماتهما (`developer.*`) كما كانت في اللغتين.
 */
describe.each(TEST_LOCALES)('developer wrappers keep their translations and behavior (%s)', (locale) => {
  const secret = TEST_MESSAGES[locale].developer.secret;
  const common = TEST_MESSAGES[locale].developer.common;

  it('SecretRevealDialog wrapper renders developer.secret labels and keeps the default dismiss behavior', () => {
    const onClose = vi.fn();
    renderIntl(<SecretRevealDialog open title="T" secret="awjkey_X" onClose={onClose} description="desc" />, locale);
    expect(screen.getByText(secret.warning)).toBeTruthy();
    expect(screen.getByText('desc')).toBeTruthy();
    expect(screen.getByRole('button', { name: secret.reveal })).toBeTruthy();
    expect(screen.getByRole('button', { name: secret.copy })).toBeTruthy();
    expect(screen.getAllByText(secret.confirm).length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SecretRevealDialog wrapper cannot opt into the lock (developer screens are unchanged)', () => {
    const onClose = vi.fn();
    renderIntl(<SecretRevealDialog open title="T" secret="awjkey_X" onClose={onClose} />, locale);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('secret-dismiss-hint')).toBeNull();
  });

  it('ConfirmDialog wrapper renders developer.common cancel/saving and the same props', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { rerender } = renderIntl(
      <ConfirmDialog open title="Revoke" message="Really?" detail="key-1" confirmLabel="Revoke" onClose={onClose} onConfirm={onConfirm} />, locale,
    );
    fireEvent.click(screen.getByRole('button', { name: common.cancel }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(<ConfirmDialog open busy title="Revoke" message="Really?" confirmLabel="Revoke" onClose={onClose} onConfirm={onConfirm} />);
    expect((screen.getByRole('button', { name: common.saving }) as HTMLButtonElement).disabled).toBe(true);
  });
});
