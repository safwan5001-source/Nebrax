// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { Dialog } from '../dialog';
import { renderIntl } from '@/test-utils/intl';

// jsdom لا يحسب تخطيطاً، فكل العناصر بلا مستطيلات؛ الحوار يستبعد غير المرئي
// من حلقة Tab، لذا نعطي كل عنصر مستطيلاً واحداً هنا.
beforeAll(() => {
  HTMLElement.prototype.getClientRects = function getClientRects() {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList;
  };
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

function Harness({ onClose = () => {}, autoFocusSecond = false }: { onClose?: () => void; autoFocusSecond?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open</button>
      <button type="button">behind</button>
      <Dialog open={open} onClose={() => { onClose(); setOpen(false); }} title="New cost center">
        <input aria-label="name" />
        <input aria-label="code" autoFocus={autoFocusSecond} />
        <button type="button">save</button>
      </Dialog>
    </>
  );
}

function openWith(locale: 'ar' | 'en' = 'en', props: Parameters<typeof Harness>[0] = {}) {
  renderIntl(<Harness {...props} />, locale);
  const opener = screen.getByRole('button', { name: 'open' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe('Dialog (ERP-UX-001/002)', () => {
  it('moves focus to the first control of the dialog body on open', () => {
    openWith();
    expect(document.activeElement).toBe(screen.getByLabelText('name'));
  });

  it('keeps focus on a control that took focus itself (autoFocus)', () => {
    openWith('en', { autoFocusSecond: true });
    expect(document.activeElement).toBe(screen.getByLabelText('code'));
  });

  it('wraps Tab from the last control to the first and Shift+Tab from the first to the last', () => {
    openWith();
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'save' });
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('pulls focus back inside when it is outside the open dialog', () => {
    openWith();
    const behind = screen.getByRole('button', { name: 'behind' });
    behind.focus();
    fireEvent.keyDown(behind, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the opener', () => {
    const onClose = vi.fn();
    const opener = openWith('en', { onClose });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('locks page scroll while open and restores it after close', () => {
    document.body.style.overflow = 'auto';
    openWith();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('auto');
  });

  it('only the top-most of two nested dialogs handles Escape', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    renderIntl(
      <Dialog open onClose={outerClose} title="outer">
        <button type="button">outer action</button>
        <Dialog open onClose={innerClose} title="inner">
          <button type="button">inner action</button>
        </Dialog>
      </Dialog>,
      'en'
    );
    act(() => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('names the close button in the interface language unless a label is passed', () => {
    openWith('ar');
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeTruthy();
    cleanup();
    openWith('en');
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    cleanup();
    renderIntl(<Dialog open onClose={() => {}} title="t" closeLabel="Dismiss"><p>x</p></Dialog>, 'en');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('keeps role, modal flag and accessible name', () => {
    openWith();
    const dialog = screen.getByRole('dialog', { name: 'New cost center' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});

describe('Dialog without an intl provider (isolated consumers)', () => {
  it('still renders and names the close button from <html lang>', async () => {
    const { render } = await import('@testing-library/react');
    document.documentElement.lang = 'en';
    render(<Dialog open onClose={() => {}} title="t"><p>x</p></Dialog>);
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    cleanup();
    document.documentElement.lang = 'ar';
    render(<Dialog open onClose={() => {}} title="t"><p>x</p></Dialog>);
    expect(screen.getByRole('button', { name: 'إغلاق' })).toBeTruthy();
  });
});
