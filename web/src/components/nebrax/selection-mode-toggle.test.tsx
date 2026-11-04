// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionModeToggle } from './selection-mode-toggle';

afterEach(cleanup);

const props = { enterLabel: 'Select', exitLabel: 'Done' };

describe('SelectionModeToggle (presentation only)', () => {
  it('shows the enter label and calls onEnter when inactive; shows no status', () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(<SelectionModeToggle active={false} onEnter={onEnter} onExit={onExit} status="3 selected" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.queryByText('3 selected')).toBeNull();
  });

  it('shows the exit label, the status and calls onExit when active', () => {
    const onEnter = vi.fn();
    const onExit = vi.fn();
    render(<SelectionModeToggle active onEnter={onEnter} onExit={onExit} status="3 selected" {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('keeps one stable button element across modes so focus survives, with a 44px mobile target', () => {
    const { rerender } = render(<SelectionModeToggle active={false} onEnter={vi.fn()} onExit={vi.fn()} {...props} />);
    const button = screen.getByRole('button', { name: 'Select' });
    button.focus();
    rerender(<SelectionModeToggle active onEnter={vi.fn()} onExit={vi.fn()} {...props} />);
    expect(screen.getByRole('button', { name: 'Done' })).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.className).toContain('min-h-11');
  });

  it('can be disabled', () => {
    const onEnter = vi.fn();
    render(<SelectionModeToggle active={false} disabled onEnter={onEnter} onExit={vi.fn()} {...props} />);
    const button = screen.getByRole('button', { name: 'Select' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onEnter).not.toHaveBeenCalled();
  });
});
