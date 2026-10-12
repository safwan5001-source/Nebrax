/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

afterEach(cleanup);

function Harness({ onConfirm = vi.fn(), busy = false }: { onConfirm?: () => void; busy?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>opener</button>
      <button>other</button>
      <ConfirmDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => { onConfirm(); }}
        title="Deactivate X?"
        description="This blocks every user."
        confirmLabel="Deactivate"
        cancelLabel="Go back"
        closeLabel="Close"
        confirmVariant="danger"
        busy={busy}
      >
        <input aria-label="reason" />
      </ConfirmDialog>
    </div>
  );
}

function openIt() {
  const opener = screen.getByRole('button', { name: 'opener' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('ConfirmDialog', () => {
  it('opens as a labelled modal dialog and sends nothing by opening', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    openIt();
    const dialog = screen.getByRole('dialog', { name: 'Deactivate X?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('This blocks every user.')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('focuses Go back first, never the destructive button', () => {
    render(<Harness />);
    openIt();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Go back' }));
  });

  it('Escape, the backdrop, the close button and Go back all cancel without confirming, and focus returns to the opener', () => {
    const onConfirm = vi.fn();
    const { container } = render(<Harness onConfirm={onConfirm} />);

    let opener = openIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    opener = openIt();
    fireEvent.click(container.querySelector('[aria-hidden="true"].absolute.inset-0') as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    opener = openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    opener = openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms only through the confirm button', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('contains Tab and Shift+Tab inside the dialog', () => {
    render(<Harness />);
    openIt();
    const items = ['Close', 'reason', 'Go back', 'Deactivate'].map((name) =>
      screen.getByRole(name === 'reason' ? 'textbox' : 'button', { name })
    );
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;

    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);

    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);

    // inside the dialog the browser keeps control
    (items[1] as HTMLElement).focus();
    expect(fireEvent.keyDown(items[1] as HTMLElement, { key: 'Tab' })).toBe(true);

    // focus that escaped to the page is pulled back
    screen.getByRole('button', { name: 'other' }).focus();
    expect(fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it('while busy: confirm and Go back are disabled and Escape does not close', () => {
    render(<Harness busy />);
    openIt();
    expect((screen.getByRole('button', { name: 'Deactivate' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Go back' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('marks the danger button with a text label and its own variant, not colour alone', () => {
    render(<Harness />);
    openIt();
    const confirm = screen.getByRole('button', { name: 'Deactivate' });
    expect(confirm.className).toContain('bg-negative');
    expect(confirm.textContent).toBe('Deactivate');
  });
});
