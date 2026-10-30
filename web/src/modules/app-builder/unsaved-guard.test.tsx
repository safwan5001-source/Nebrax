/* @vitest-environment jsdom */
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnsavedChangesGuard } from './unsaved-guard';

const navigate = vi.fn();

function Harness({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedChangesGuard(dirty, navigate);
  return (
    <div>
      <a href="/commerce">internal</a>
      <a href="/commerce" target="_blank">blank</a>
      <a href="https://example.org/x">external</a>
      <a href="#section">hash</a>
      <a href="mailto:a@b.c">mail</a>
      <a href={window.location.pathname}>same</a>
      <output data-testid="pending">{guard.pending ? JSON.stringify(guard.pending) : 'none'}</output>
      <button onClick={guard.confirmLeave}>leave</button>
      <button onClick={guard.cancelLeave}>stay</button>
    </div>
  );
}

const pending = () => screen.getByTestId('pending').textContent;

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => navigate.mockReset());
  afterEach(cleanup);

  it('does nothing while the editor is clean', () => {
    render(<Harness dirty={false} />);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByText('internal').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(pending()).toBe('none');
  });

  it('intercepts an internal link click while dirty and asks instead of navigating', () => {
    render(<Harness dirty />);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => { screen.getByText('internal').dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(JSON.parse(pending()!)).toEqual({ kind: 'link', href: '/commerce' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([['target=_blank', 'blank'], ['external origin', 'external'], ['hash-only', 'hash'], ['mailto', 'mail'], ['same location', 'same']])(
    'does not intercept %s links', (_n, label) => {
      render(<Harness dirty />);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      screen.getByText(label).dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(pending()).toBe('none');
    },
  );

  it.each([['ctrl', { ctrlKey: true }], ['meta', { metaKey: true }], ['shift', { shiftKey: true }], ['middle button', { button: 1 }]])(
    'does not intercept a %s click (new tab/window)', (_n, init) => {
      render(<Harness dirty />);
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
      screen.getByText('internal').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it('Stay clears the pending leave without navigating; Leave navigates to the intercepted link', () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText('internal'));
    fireEvent.click(screen.getByText('stay'));
    expect(pending()).toBe('none');
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('internal'));
    fireEvent.click(screen.getByText('leave'));
    expect(navigate).toHaveBeenCalledWith('/commerce');
  });

  it('prompts on beforeunload only while dirty', () => {
    const { rerender } = render(<Harness dirty={false} />);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    rerender(<Harness dirty />);
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it('turns the browser Back button into a prompt while dirty and re-pushes the guard entry', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(<Harness dirty />);
    const pushesAfterDirty = push.mock.calls.length;
    expect(pushesAfterDirty).toBeGreaterThanOrEqual(1); // دُفع إدخال الحارس عند أول dirty

    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(JSON.parse(pending()!)).toEqual({ kind: 'back' });
    expect(push.mock.calls.length).toBe(pushesAfterDirty + 1); // أُعيد دفع الحارس فبقي المستخدم في مكانه
    push.mockRestore();
  });

  it('ignores popstate while clean', () => {
    render(<Harness dirty={false} />);
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(pending()).toBe('none');
  });

  it('confirming a back-leave walks history past the guard entry and stops prompting', () => {
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
    render(<Harness dirty />);
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    fireEvent.click(screen.getByText('leave'));
    expect(go).toHaveBeenCalledWith(-2);

    const afterLeave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterLeave);
    expect(afterLeave.defaultPrevented).toBe(false);
    go.mockRestore();
  });
});
