/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SbcSeal } from './SbcSeal';

describe('SbcSeal customizer preview', () => {
  it('renders an informational state without loading government JavaScript', () => {
    render(<SbcSeal message="Official seal appears on the published storefront." />);

    expect(screen.getByTestId('sbc-seal-preview').textContent).toBe(
      'Official seal appears on the published storefront.',
    );
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[data-token]')).toBeNull();
  });
});
