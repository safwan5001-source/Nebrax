/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';

// H15-09: the opt-in `wrap` of Badge and Button. The default must stay exactly what it was (the ERP uses these
// everywhere); `wrap` only changes behaviour for the platform screens that pass it.
afterEach(cleanup);
const classes = (node: Element) => node.className.split(/\s+/).filter(Boolean);

describe('Badge wrap (H15-09)', () => {
  it('keeps the default exactly as before: one line, no shrink or max-width rules', () => {
    const { container } = render(<Badge>Coming soon</Badge>);
    const c = classes(container.firstElementChild!);
    expect(c).toContain('whitespace-nowrap');
    expect(c).not.toContain('whitespace-normal');
    expect(c).not.toContain('shrink-0');
    expect(c).not.toContain('max-w-full');
  });

  it('wrap lets the text wrap only when the container is narrower, without shrinking early', () => {
    const { container } = render(<Badge wrap>Coming soon</Badge>);
    const c = classes(container.firstElementChild!);
    expect(c).not.toContain('whitespace-nowrap');
    expect(c).toEqual(expect.arrayContaining(['whitespace-normal', 'max-w-full', 'shrink-0', 'break-words', 'text-start']));
    // the look is untouched: same box, padding, size and tone classes
    expect(c).toEqual(expect.arrayContaining(['inline-flex', 'items-center', 'rounded', 'px-2', 'py-0.5', 'text-xs', 'font-medium', 'bg-primary-soft', 'text-primary']));
  });

  it('wrap does not prevent a caller from overriding classes, and tone/props are kept', () => {
    const { container } = render(<Badge wrap tone="warning" className="px-3" data-x="1">Mandatory</Badge>);
    const node = container.firstElementChild!;
    expect(classes(node)).toContain('px-3');
    expect(classes(node)).not.toContain('px-2');
    expect(classes(node)).toContain('text-warning');
    expect(node.getAttribute('data-x')).toBe('1');
    expect(node.textContent).toBe('Mandatory');
  });
});

describe('Button wrap (H15-09)', () => {
  it('keeps the default exactly as before: fixed height, one line', () => {
    const { container } = render(<Button size="sm">Grant all</Button>);
    const c = classes(container.querySelector('button')!);
    expect(c).toEqual(expect.arrayContaining(['h-8', 'px-3', 'whitespace-nowrap']));
    expect(c).not.toContain('h-auto');
    expect(c).not.toContain('min-h-8');
    expect(c).not.toContain('shrink-0');
  });

  it('wrap turns the fixed height into the same minimum height and lets the label wrap', () => {
    const sm = classes(render(<Button size="sm" wrap>Grant all apps to all tenants</Button>).container.querySelector('button')!);
    expect(sm).toEqual(expect.arrayContaining(['h-auto', 'min-h-8', 'whitespace-normal', 'max-w-full', 'shrink-0', 'py-1', 'text-center']));
    expect(sm).not.toContain('h-8');
    expect(sm).not.toContain('whitespace-nowrap');
    cleanup();
    const md = classes(render(<Button wrap>Save</Button>).container.querySelector('button')!);
    expect(md).toEqual(expect.arrayContaining(['h-auto', 'min-h-9']));
    expect(md).not.toContain('h-9');
  });

  it('a caller minimum height wins over the default minimum, and the look classes are kept', () => {
    const c = classes(render(<Button variant="outline" size="sm" wrap className="min-h-11">Test connection</Button>).container.querySelector('button')!);
    expect(c).toContain('min-h-11');
    expect(c).not.toContain('min-h-8');
    expect(c).toEqual(expect.arrayContaining(['border', 'border-border', 'bg-surface', 'text-sm', 'font-medium', 'focus-visible:ring-2']));
  });

  it('works through asChild and does not leak the prop to the DOM', () => {
    const { container } = render(<Button asChild wrap><a href="/x">Back to tenants</a></Button>);
    const a = container.querySelector('a')!;
    expect(classes(a)).toEqual(expect.arrayContaining(['h-auto', 'whitespace-normal']));
    expect(a.hasAttribute('wrap')).toBe(false);
    expect(container.querySelector('button')).toBeNull();
  });
});
