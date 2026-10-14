// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRestoreFocus } from './use-restore-focus';

let restore: ((event: Event) => void) | null = null;

function Panel() {
  restore = useRestoreFocus();
  return <p>panel</p>;
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button id="opener" onClick={() => setOpen(true)}>open</button>
      {open ? <Panel /> : null}
    </div>
  );
}

const closeEvent = () => {
  const event = new Event('closeautofocus', { cancelable: true });
  return event;
};

afterEach(() => {
  cleanup();
  restore = null;
});

describe('useRestoreFocus', () => {
  it('returns focus to the element that opened the panel and cancels the default', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    act(() => { opener.focus(); });
    act(() => { opener.click(); });
    act(() => { document.body.focus(); (document.activeElement as HTMLElement | null)?.blur(); });
    expect(document.activeElement).not.toBe(opener);

    const event = closeEvent();
    act(() => { restore!(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('leaves the default behaviour alone when the opener is gone', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    act(() => { opener.focus(); });
    act(() => { opener.click(); });
    opener.remove();

    const event = closeEvent();
    act(() => { restore!(event); });
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing when nothing meaningful had focus at open time', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    act(() => { opener.click(); }); // click sin تركيز (jsdom لا يركّز بالنقر البرمجي)
    const event = closeEvent();
    act(() => { restore!(event); });
    expect(event.defaultPrevented).toBe(false);
  });
});
