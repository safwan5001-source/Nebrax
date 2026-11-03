// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('mobilePopover مع popupRole=dialog: يُثبَّت المحتوى تحت الزر لا في موضع الاحتياط (Codex)', () => {
    const { getByRole } = render(
      <Dropdown mobilePopover popupRole="dialog" menuLabel="m" triggerLabel="t" trigger={<span>x</span>} align="end">
        <div>body</div>
      </Dropdown>,
    );
    const trigger = screen.getByRole('button', { name: 't' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ bottom: 80, right: 300, top: 40, left: 260, width: 40, height: 40, x: 260, y: 40, toJSON: () => ({}) } as DOMRect);
    fireEvent.click(trigger);
    const panel = getByRole('dialog', { hidden: true });
    // top = bottom(80) + 4؛ لو لم يُعثر على المرساة لبقي الاحتياط top:12
    expect(panel.style.top).toBe('84px');
  });

  it('التمرير داخل اللوحة لا يُغلقها، والتمرير خارجها يُغلقها (Codex)', () => {
    const { getByRole } = render(
      <Dropdown mobilePopover popupRole="dialog" menuLabel="m" triggerLabel="t" trigger={<span>x</span>} align="end">
        <div data-testid="list">body</div>
      </Dropdown>,
    );
    const trigger = screen.getByRole('button', { name: 't' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.scroll(screen.getByTestId('list')); // يُحاكي تمرير القائمة الداخلية
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(getByRole('dialog', { hidden: true })).toBeTruthy();

    fireEvent.scroll(document.body); // تمرير الصفحة
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
