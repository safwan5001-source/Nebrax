// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LtrNumber } from '../ltr-number';

afterEach(cleanup);

describe('LtrNumber (ERP-UX-027)', () => {
  it.each(['-10,471.50 𞸁', '1,150.00 𞸁', '+3.5%', '٣٬٠٢٨'])('isolates numeric text %s left-to-right without changing it', (text) => {
    const { container } = render(<p dir="rtl"><LtrNumber>{text}</LtrNumber></p>);
    const bdi = container.querySelector('bdi');
    expect(bdi?.getAttribute('dir')).toBe('ltr');
    expect(container.textContent).toBe(text);
  });

  it.each(['—', 'متوازن', 'Balanced'])('passes non-numeric text %s through untouched', (text) => {
    const { container } = render(<p><LtrNumber>{text}</LtrNumber></p>);
    expect(container.querySelector('bdi')).toBeNull();
    expect(container.textContent).toBe(text);
  });
});
