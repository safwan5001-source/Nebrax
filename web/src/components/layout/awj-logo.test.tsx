// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AwjLogo } from './awj-logo';
import { CompanyLogoMark } from './company-logo-mark';

afterEach(cleanup);

describe('AWJ vector identity', () => {
  it('supports an accessible image and keeps inline artwork font-independent', () => {
    const { container } = render(<AwjLogo alt="أَوْج | AWJ" priority />);
    const logo = screen.getByRole('img', { name: 'أَوْج | AWJ' });
    expect(logo.tagName.toLowerCase()).toBe('svg');
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.querySelector('text, image, img')).toBeNull();
    expect(container.querySelector('g')?.getAttribute('fill')).toBe('currentColor');
  });

  it('keeps decorative instances hidden and accepts existing sizing classes', () => {
    const { container } = render(<AwjLogo alt="" className="h-14 w-auto" />);
    const logo = container.querySelector('svg');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(logo?.getAttribute('focusable')).toBe('false');
    expect(logo?.classList.contains('h-14')).toBe(true);
    expect(logo?.classList.contains('h-10')).toBe(false);
  });

  it('keeps the same artwork and geometry in RTL and LTR', () => {
    const { container, rerender } = render(<div dir="rtl"><AwjLogo /></div>);
    const before = container.querySelector('svg')?.outerHTML;
    rerender(<div dir="ltr"><AwjLogo /></div>);
    expect(container.querySelector('svg')?.outerHTML).toBe(before);
  });

  it('provides the full lockup and a narrow compact mark for constrained headers', () => {
    const { container, rerender } = render(<AwjLogo variant="full" />);
    const fullPaths = container.querySelectorAll('path').length;
    rerender(<AwjLogo variant="mark" />);
    const [,, width, height] = (container.querySelector('svg')?.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(container.querySelectorAll('path').length).toBeLessThan(fullPaths);
    expect(width / height).toBeLessThan(0.3);
  });
});

describe('company identity precedence during the AWJ visual update', () => {
  it('preserves an uploaded company logo instead of rendering the AWJ fallback', () => {
    const { container } = render(<CompanyLogoMark logo="https://example.com/company.png" name="Company" />);
    expect(screen.getByRole('img', { name: 'Company' }).getAttribute('src')).toBe('https://example.com/company.png');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('falls back on image failure, then retries when the company logo changes', () => {
    const { container, rerender } = render(<CompanyLogoMark logo="https://example.com/old.png" name="Company" />);
    fireEvent.error(screen.getByRole('img', { name: 'Company' }));
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<CompanyLogoMark logo="https://example.com/new.png" name="Company" />);
    expect(screen.getByRole('img', { name: 'Company' }).getAttribute('src')).toBe('https://example.com/new.png');
    expect(container.querySelector('svg')).toBeNull();
  });
});
