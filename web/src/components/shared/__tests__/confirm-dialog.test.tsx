// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { renderIntl } from '@/test-utils/intl';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base = {
  open: true,
  title: 'Disable point',
  message: 'This cannot be undone.',
  confirmLabel: 'Disable',
  cancelLabel: 'Back',
  busyLabel: 'Working…',
};

describe('neutral ConfirmDialog', () => {
  it('shows exactly the labels it is given (no translation namespace of its own)', () => {
    renderIntl(<ConfirmDialog {...base} onClose={() => {}} onConfirm={() => {}} />, 'ar');
    expect(screen.getByRole('dialog', { name: 'Disable point' })).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy();
  });

  it('confirm and cancel call their handlers; the destructive button carries the danger tone only when asked', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = renderIntl(<ConfirmDialog {...base} onClose={onClose} onConfirm={onConfirm} />, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const dangerClass = screen.getByRole('button', { name: 'Disable' }).className;

    rerender(<ConfirmDialog {...base} danger={false} onClose={onClose} onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Disable' }).className).not.toBe(dangerClass);
  });

  it('while busy both buttons are inert and the busy label replaces the confirm label', () => {
    const onConfirm = vi.fn();
    renderIntl(<ConfirmDialog {...base} busy onClose={() => {}} onConfirm={onConfirm} />, 'en');
    const busy = screen.getByRole('button', { name: 'Working…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
    fireEvent.click(busy);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders the technical detail left-to-right and only when given', () => {
    const { rerender } = renderIntl(<ConfirmDialog {...base} detail="store-100" onClose={() => {}} onConfirm={() => {}} />, 'ar');
    expect(screen.getByText('store-100').getAttribute('dir')).toBe('ltr');
    rerender(<ConfirmDialog {...base} onClose={() => {}} onConfirm={() => {}} />);
    expect(screen.queryByText('store-100')).toBeNull();
  });
});
