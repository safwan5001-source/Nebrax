/* @vitest-environment jsdom */
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './button';

const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function contrast(foreground: string, background: string): number {
  const channel = (hex: string) => {
    const value = Number.parseInt(hex, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color: string) => {
    const hex = color.replace('#', '');
    const r = channel(hex.slice(0, 2));
    const g = channel(hex.slice(2, 4));
    const b = channel(hex.slice(4, 6));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function mountCascade() {
  const style = document.createElement('style');
  style.textContent = `
    :root { --negative: #b91c1c; --danger-fg: #ffffff; }
    .dark { --negative: #f87171; --danger-fg: #0e1014; }
    .text-white { color: #ffffff; }
    .bg-negative { background-color: var(--negative); }
    .dark .bg-negative.text-white { color: var(--danger-fg); }
    html[data-awj-ui="3"].dark { --awj-text-inverse: #0E1A31; }
    html[data-awj-ui="3"].dark .bg-negative.text-white { color: var(--awj-text-inverse); }
  `;
  document.head.appendChild(style);
  return style;
}

afterEach(() => {
  cleanup();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-awj-ui');
  document.head.querySelectorAll('style').forEach((node) => node.remove());
  document.body.innerHTML = '';
});

describe('danger button contrast', () => {
  it('keeps the danger classes and sizes the CSS hook depends on', () => {
    const { getByRole } = render(<Button variant="danger">حذف</Button>);
    const button = getByRole('button');
    expect(button.className).toContain('bg-negative');
    expect(button.className).toContain('text-white');
    expect(button.className).toContain('hover:opacity-90');
    expect(button.className).toContain('h-9');
    expect(button.className).not.toContain('h-11');

    const small = render(<Button variant="danger" size="sm">صغير</Button>).getByRole('button', { name: 'صغير' });
    expect(small.className).toContain('h-8');
    const icon = render(<Button variant="danger" size="icon" aria-label="أيقونة">x</Button>).getByRole('button', { name: 'أيقونة' });
    expect(icon.className).toContain('h-9');
    expect(icon.className).toContain('w-9');
  });

  it('declares the gate-off tokens without changing --negative or the v3 winner', () => {
    expect(css).toContain('--negative: #b91c1c;');
    expect(css).toContain('--negative: #f87171;');
    expect(css).toContain('--danger-fg: #ffffff;');
    expect(css).toContain('--danger-fg: #0e1014;');
    expect(css).toContain('.dark .bg-negative.text-white {\n  color: var(--danger-fg);\n}');
    expect(css).toContain('html[data-awj-ui="3"].dark .bg-negative.text-white {\n  color: var(--awj-text-inverse);\n}');
    const gateOff = css.indexOf('.dark .bg-negative.text-white {\n  color: var(--danger-fg);');
    const v3 = css.indexOf('html[data-awj-ui="3"].dark .bg-negative.text-white {\n  color: var(--awj-text-inverse);');
    expect(gateOff).toBeGreaterThan(-1);
    expect(v3).toBeGreaterThan(gateOff);
    expect(contrast('#ffffff', '#f87171')).toBeLessThan(4.5);
    expect(contrast('#0e1014', '#f87171')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', '#b91c1c')).toBeGreaterThanOrEqual(4.5);
  });

  it('uses near-black danger text on the light red fill in gate-off dark, and white in light', () => {
    mountCascade();
    const { getByRole, rerender } = render(<Button variant="danger">حذف</Button>);
    const button = getByRole('button');

    expect(getComputedStyle(button).color).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(button).backgroundColor).toBe('var(--negative)');

    document.documentElement.classList.add('dark');
    rerender(<Button variant="danger">حذف</Button>);
    // jsdom keeps the specified custom property. The token itself is #0e1014.
    expect(getComputedStyle(button).color).toBe('var(--danger-fg)');
    expect(getComputedStyle(button).backgroundColor).toBe('var(--negative)');
  });

  it('lets the v3 dark rule win over --danger-fg', () => {
    mountCascade();
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-awj-ui', '3');
    const { getByRole } = render(<Button variant="danger">حذف</Button>);
    expect(getComputedStyle(getByRole('button')).color).toBe('var(--awj-text-inverse)');
  });
});

describe('Button asChild', () => {
  it('renders a navigational child as a semantic anchor without a nested button', () => {
    render(
      <Button asChild variant="outline">
        <a href="/invoices">الفواتير</a>
      </Button>
    );

    const link = screen.getByRole('link', { name: 'الفواتير' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/invoices');
    expect(link.querySelector('button')).toBeNull();
  });

  it('keeps the danger classes on an asChild anchor', () => {
    render(
      <Button asChild variant="danger">
        <a href="/x">حذف</a>
      </Button>
    );
    const link = screen.getByRole('link', { name: 'حذف' });
    expect(link.className).toContain('bg-negative');
    expect(link.className).toContain('text-white');
  });
});
