// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocLayout } from './doc-layout';
import { ThermalLayout } from '../thermal-layout';
import { getTheme } from '../../themes';

afterEach(cleanup);

const css = readFileSync(resolve(__dirname, '../../../../app/globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing CSS block ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('Document paper keeps a light palette in dark mode (ERP-UX-H1-6A)', () => {
  it('marks the A4 and thermal paper roots', () => {
    const theme = getTheme('blue');
    const { container } = render(
      <>
        <DocLayout theme={theme} direction="rtl"><p>a4</p></DocLayout>
        <ThermalLayout theme={theme} direction="rtl" widthMm={80}><p>roll</p></ThermalLayout>
      </>,
    );
    expect(container.querySelectorAll('[data-doc-paper]').length).toBe(2);
  });

  it('pins dark-on-white text tokens on the paper for legacy and v3 dark mode only', () => {
    const legacy = block('.dark [data-doc-paper]');
    expect(legacy).toContain('--text: #15181d');
    expect(legacy).toContain('--muted: #6b7280');
    expect(legacy).toContain('color-scheme: light');
    const v3 = block('html[data-awj-ui="3"].dark [data-doc-paper]');
    expect(v3).toContain('--text: #15181d');
    expect(v3).toContain('--muted: #586172');
    expect(css).not.toMatch(/(^|\n)\[data-doc-paper\]\s*\{/);
  });
});
