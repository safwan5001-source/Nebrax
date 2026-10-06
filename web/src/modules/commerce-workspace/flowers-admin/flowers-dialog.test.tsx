// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';
import { FlowersDialog } from './flowers-dialog';

afterEach(cleanup);

// jsdom has no layout: report every element as rendered so the visibility filter keeps them.
vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{}] as unknown as DOMRectList);

function Harness({ autoFocusSecond = false }: { autoFocusSecond?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      {open ? (
        <FlowersDialog onClose={() => setOpen(false)} title="Dialog title">
          <input aria-label="first" />
          <input aria-label="second" autoFocus={autoFocusSecond} />
          <button type="button">last</button>
        </FlowersDialog>
      ) : null}
    </>
  );
}

describe('FlowersDialog', () => {
  it('moves focus to the first field, keeps Tab inside, and returns focus to the opener on close', async () => {
    const user = userEvent.setup();
    renderIntl(<Harness />, 'en');
    await user.click(screen.getByRole('button', { name: 'opener' }));

    expect(document.activeElement).toBe(screen.getByLabelText('first'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('second'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
    await user.tab(); // wraps to the close button (first focusable in the dialog), never behind the overlay
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'opener' }));
  });

  it('respects an element that already took focus (autoFocus) and labels the close button in the UI language', async () => {
    const user = userEvent.setup();
    renderIntl(<Harness autoFocusSecond />, 'en');
    await user.click(screen.getByRole('button', { name: 'opener' }));

    expect(document.activeElement).toBe(screen.getByLabelText('second'));
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy();
  });
});
