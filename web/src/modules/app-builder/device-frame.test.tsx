/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceFrame } from './device-frame';

afterEach(cleanup);

describe('DeviceFrame — MOBILE-PREVIEW-3 device-frame shell', () => {
  it('renders its children unmodified inside the bezel', () => {
    render(
      <DeviceFrame preset="iphone">
        <p>محتوى المعاينة</p>
      </DeviceFrame>
    );
    expect(screen.getByText('محتوى المعاينة')).toBeTruthy();
  });

  it('tags itself with the preset for callers/tests to target (iPhone vs Android)', () => {
    const { container, rerender } = render(
      <DeviceFrame preset="iphone">
        <span />
      </DeviceFrame>
    );
    expect(container.querySelector('[data-device-frame="iphone"]')).toBeTruthy();

    rerender(
      <DeviceFrame preset="android">
        <span />
      </DeviceFrame>
    );
    expect(container.querySelector('[data-device-frame="android"]')).toBeTruthy();
    expect(container.querySelector('[data-device-frame="iphone"]')).toBeNull();
  });

  it('sizes the inner screen area to the preset dimensions only at the `lg` breakpoint and up — never a fixed inline size', () => {
    render(
      <DeviceFrame preset="android">
        <span>x</span>
      </DeviceFrame>
    );
    const screenEl = screen.getByText('x').parentElement as HTMLElement;
    // MOBILE-PREVIEW-3 benchmark B2 (Salla official docs + Shopify's own
    // "collapse sidebar -> full-width preview" pattern): no tiny phone inside the
    // phone on small/mobile-admin screens — sizing is Tailwind `lg:`-gated classes,
    // never a plain inline style that would apply at every viewport.
    expect(screenEl.style.width).toBe('');
    expect(screenEl.style.height).toBe('');
    expect(screenEl.className).toContain('lg:w-[412px]');
    expect(screenEl.className).toContain('lg:h-[915px]');
    expect(screenEl.className).toContain('h-full');
    expect(screenEl.className).toContain('w-full');
  });

  it('below `lg` the bezel chrome (frame background, padding, notch/camera dot) is entirely absent, not just visually hidden', () => {
    const { container } = render(
      <DeviceFrame preset="iphone">
        <span>x</span>
      </DeviceFrame>
    );
    const outer = container.querySelector('[data-device-frame="iphone"]') as HTMLElement;
    const outerTokens = outer.className.split(/\s+/);
    // Exact-token check, not substring — `lg:bg-neutral-900` itself contains the
    // substring "bg-neutral-900", so a naive `.not.toContain` would false-fail here.
    expect(outerTokens).not.toContain('bg-neutral-900');
    expect(outerTokens).toContain('lg:bg-neutral-900');
    expect(outerTokens).toContain('h-full');
    expect(outerTokens).toContain('w-full');
    // The notch silhouette exists in the DOM (for `lg:block`) but is `hidden` by default.
    const notch = container.querySelector('[aria-hidden="true"]');
    expect(notch?.className).toContain('hidden');
    expect(notch?.className).toContain('lg:block');
  });
});
