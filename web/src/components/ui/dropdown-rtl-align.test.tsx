// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import { Dropdown } from './dropdown';


describe('Dropdown: محاذاة النهاية على الشاشات العريضة في RTL (COPS-H3-3)', () => {
  afterEach(cleanup);

  it('mobilePopover + align=end يثبّت left:0 صراحةً في RTL كي لا تخرج القائمة عن الشاشة، ويبقى end-0 لـLTR', () => {
    const { getByRole } = render(
      <Dropdown mobilePopover popupRole="dialog" menuLabel="m" triggerLabel="t" trigger={<span>x</span>} align="end">
        <div>body</div>
      </Dropdown>,
    );
    const cls = getByRole('dialog', { hidden: true }).className;
    expect(cls).toContain('lg:end-0');
    expect(cls).toContain('lg:rtl:!left-0');
  });

  it('align=start لا يتأثر', () => {
    const { getByRole } = render(
      <Dropdown mobilePopover popupRole="dialog" menuLabel="m" triggerLabel="t" trigger={<span>x</span>} align="start">
        <div>body</div>
      </Dropdown>,
    );
    const cls = getByRole('dialog', { hidden: true }).className;
    expect(cls).toContain('lg:start-0');
    expect(cls).not.toContain('lg:rtl:!left-0');
  });
});
