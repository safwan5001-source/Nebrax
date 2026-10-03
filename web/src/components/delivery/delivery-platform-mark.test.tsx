/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeliveryPlatformMark } from './delivery-platform-mark';
import {
  DELIVERY_PLATFORM_LOGO_PROVENANCE,
  deliveryPlatformPresentations,
} from '@/lib/delivery-platform-registry';

afterEach(cleanup);

const NAMES: Record<string, string> = {
  hungerstation: 'هنقرستيشن',
  jahez: 'جاهز',
  mrsool: 'مرسول',
  keeta: 'كيتا',
  ninja: 'نينجا',
  the_chefz: 'ذا شيفز',
};

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('DeliveryPlatformMark', () => {
  it('shows the official square logo and the platform name for every canonical platform', () => {
    render(
      <div dir="rtl" className="dark">
        {deliveryPlatformPresentations().map((platform) => (
          <DeliveryPlatformMark key={platform.key} platformKey={platform.key} name={NAMES[platform.key]} />
        ))}
      </div>,
    );

    for (const platform of deliveryPlatformPresentations()) {
      expect(screen.getByText(NAMES[platform.key]).className).not.toMatch(/sr-only|hidden/);
      const mark = screen.getByText(NAMES[platform.key]).closest('[data-testid="delivery-platform-mark"]');
      const img = mark?.querySelector('img');
      expect(img?.getAttribute('src')).toBe(platform.logoSrc);
      expect(img?.getAttribute('alt')).toBe('');
      expect(img?.className).toContain('object-contain');
      expect(img?.className).not.toMatch(/invert|brightness|hue-rotate|saturate|grayscale|sepia/);
      expect(img?.getAttribute('width')).toBe('512');
      expect(img?.getAttribute('height')).toBe('512');
    }
  });

  it('keeps a monogram only for an unknown platform or a broken official file', () => {
    render(
      <>
        <DeliveryPlatformMark platformKey="custom" name="خاصة" />
        <DeliveryPlatformMark platformKey="jahez" name="جاهز" />
      </>,
    );
    const unknown = screen.getByText('خاصة').closest('[data-testid="delivery-platform-mark"]');
    expect(unknown?.querySelector('img')).toBeNull();
    expect(unknown?.querySelector('[data-mark="monogram"]')?.textContent).toBe('خ');

    const img = screen.getByText('جاهز').closest('[data-testid="delivery-platform-mark"]')?.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    const broken = screen.getByText('جاهز').closest('[data-testid="delivery-platform-mark"]');
    expect(broken?.querySelector('img')).toBeNull();
    expect(broken?.querySelector('[data-mark="monogram"]')?.textContent).toBe('J');
    expect(broken?.textContent).toContain('جاهز');
  });

  it('commits one unaltered 512 square file per canonical platform', () => {
    expect(DELIVERY_PLATFORM_LOGO_PROVENANCE.map((row) => row.key)).toEqual(
      deliveryPlatformPresentations().map((platform) => platform.key),
    );
    for (const row of DELIVERY_PLATFORM_LOGO_PROVENANCE) {
      const platform = deliveryPlatformPresentations().find((item) => item.key === row.key);
      expect(platform?.logoSrc).toBe(`/delivery-platforms/${row.file}`);
      const bytes = readFileSync(resolve(process.cwd(), 'public/delivery-platforms', row.file));
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(pngSize(bytes)).toEqual({ width: 512, height: 512 });
      expect(row.publisher.length).toBeGreaterThan(0);
      expect(row.source).toMatch(/^https:\/\/apps\.apple\.com\/sa\/app\//);
    }
  });
});
