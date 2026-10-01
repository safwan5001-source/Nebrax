import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Money } from '../money';
import { formatRiyal } from '@/lib/money';

describe('<Money /> — gate-off text content matches formatRiyal exactly', () => {
  it.each([0, 1150, '1150.00', 1234567.5, -115, '-115.00', null, undefined])(
    'renders the same text as formatRiyal(%j) when the v3 gate is off',
    (value) => {
      document.documentElement.removeAttribute('data-awj-ui');
      const { container } = render(<Money value={value} />);
      expect(container.textContent).toBe(formatRiyal(value));
    }
  );

  it('exposes data-awj-money-integer / -decimal markers for the gated CSS to target', () => {
    const { container } = render(<Money value={1150.5} />);
    expect(container.querySelector('[data-awj-money-integer]')?.textContent).toBe('1,150');
    expect(container.querySelector('[data-awj-money-decimal]')?.textContent).toBe('.50');
  });

  it('marks the negative sign with data-awj-money-negative, separate from the integer part', () => {
    const { container } = render(<Money value={-115} />);
    expect(container.querySelector('[data-awj-money-negative]')?.textContent).toBe('-');
    expect(container.querySelector('[data-awj-money-integer]')?.textContent).toBe('115');
  });

  it('renders an em dash for an invalid value, matching formatRiyal', () => {
    const { container } = render(<Money value={'ليس رقماً'} />);
    expect(container.textContent).toBe('—');
    expect(container.textContent).toBe(formatRiyal('ليس رقماً'));
  });
});
