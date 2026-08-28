// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosDialog } from './pos-dialog';

afterEach(() => cleanup());

describe('PosDialog touch close', () => {
  it('يغلق بالضغط على هدف الإغلاق ويحافظ على Escape', () => {
    const onClose = vi.fn();
    render(
      <PosDialog open onClose={onClose} title="Held sales">
        <p>content</p>
        <button type="button">Primary</button>
        <button type="button">Secondary</button>
      </PosDialog>,
    );

    const close = screen.getByRole('button', { name: 'إغلاق' });
    expect(close.className).toMatch(/min-h-11/);
    expect(close.className).toMatch(/min-w-11/);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('يبقي الإجراءات الأساسية والثانوية قابلة للضغط', () => {
    render(
      <PosDialog open onClose={vi.fn()} title="Confirm">
        <button type="button">Cancel</button>
        <button type="button">Confirm</button>
      </PosDialog>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });
});
