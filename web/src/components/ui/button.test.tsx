/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './button';

afterEach(cleanup);

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
});
