/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEVICE_FRAME_PRESETS, DeviceFrame } from './device-frame';

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

  it('sizes the inner screen area to the preset dimensions', () => {
    render(
      <DeviceFrame preset="android">
        <span>x</span>
      </DeviceFrame>
    );
    const screenEl = screen.getByText('x').parentElement as HTMLElement;
    expect(screenEl.style.width).toBe(`${DEVICE_FRAME_PRESETS.android.width}px`);
    expect(screenEl.style.height).toBe(`${DEVICE_FRAME_PRESETS.android.height}px`);
  });
});
