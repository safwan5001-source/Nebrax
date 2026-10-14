// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CardTitle, CardTitleLevel } from '../card';

afterEach(cleanup);

describe('CardTitle level inside ERP workspaces (ERP-UX-014)', () => {
  it('follows the nearest CardTitleLevel, so cards right under the page h1 are h2', () => {
    render(<CardTitleLevel level="h2"><CardTitle>Details</CardTitle></CardTitleLevel>);
    const title = screen.getByRole('heading', { level: 2, name: 'Details' });
    expect(title.className).toBe('text-sm font-medium text-muted');
  });

  it('keeps h3 without a provider and lets an explicit `as` win over the provider', () => {
    render(
      <>
        <CardTitle>Outside</CardTitle>
        <CardTitleLevel level="h2"><CardTitle as="h3">Nested</CardTitle></CardTitleLevel>
      </>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Outside' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Nested' })).toBeTruthy();
  });

  it('is set to h2 by the ERP and Fuel layouts', () => {
    const src = resolve(__dirname, '../../..');
    for (const layout of ['app/(app)/layout.tsx', 'app/(fuel)/layout.tsx']) {
      expect(readFileSync(resolve(src, layout), 'utf8')).toMatch(/<CardTitleLevel level="h2">/);
    }
  });
});
