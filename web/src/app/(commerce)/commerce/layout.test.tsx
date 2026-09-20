// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pathname = vi.hoisted(() => ({ current: '/commerce/appearance' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

import CommerceSectionLayout from './layout';

describe('Commerce section layout', () => {
  afterEach(() => {
    cleanup();
    pathname.current = '/commerce/appearance';
  });

  it('constrains the Customizer to the available flex height', () => {
    const { container } = render(
      <CommerceSectionLayout>
        <div data-testid="customizer-child" />
      </CommerceSectionLayout>,
    );

    const className = container.firstElementChild?.getAttribute('class') ?? '';
    expect(className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'h-full', 'min-h-0', 'flex-col']));
    expect(className).not.toContain('space-y-5');
  });

  it('preserves spacing for other Commerce pages', () => {
    pathname.current = '/commerce/orders';
    const { container } = render(
      <CommerceSectionLayout>
        <div data-testid="commerce-child" />
      </CommerceSectionLayout>,
    );

    const className = container.firstElementChild?.getAttribute('class') ?? '';
    expect(className).toContain('space-y-5');
    expect(className).not.toContain('min-h-0');
  });
});
