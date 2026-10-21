/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FacetVisualTile } from '../FacetVisualTile';
import type { ResolvedFacetVisual } from '../presentation/facet-visual';
import { facetLabelHidden } from '../discovery-label-visibility';

const repo = (path: string) => readFileSync(resolve(process.cwd(), '..', path), 'utf8');

const visual: ResolvedFacetVisual = {
  content: 'image',
  image: { mediaId: '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e', fit: 'cover' },
  fallbackIcon: 'gift',
  shape: 'heart',
  size: 'md',
  showLabel: true,
};

afterEach(cleanup);

describe('admin preview FacetVisualTile (VD-2)', () => {
  it('mirrors the storefront tile: same markup and behaviour apart from imports', () => {
    // Everything from the component signature down must be identical; only imports and the docblock differ.
    const body = (source: string) =>
      source
        .slice(source.indexOf('export function FacetVisualTile'))
        .replace(/\/\/ biome-ignore[^\n]*\n/g, '');
    expect(body(repo('web/src/modules/store-experience-builder/FacetVisualTile.tsx'))).toBe(
      body(repo('storefront/src/components/ui/facet-visual-tile.tsx')),
    );
  });

  it('previews the shape mask and falls back to the icon on a load error', () => {
    const { container } = render(<FacetVisualTile visual={visual} label="الأم" image={{ src: '/preview.webp' }} />);
    const frame = container.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(frame.style.getPropertyValue('mask-image') || frame.getAttribute('style')).toContain('data:image/svg+xml');
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('الأم')).toBeTruthy();
  });

  it('keeps counts visible when a hidden label falls back to an initial', () => {
    expect(facetLabelHidden({ ...visual, showLabel: false, fallbackIcon: undefined }, null)).toBe(false);
    expect(facetLabelHidden({ ...visual, showLabel: false }, { src: '/preview.webp' })).toBe(true);
  });
});
