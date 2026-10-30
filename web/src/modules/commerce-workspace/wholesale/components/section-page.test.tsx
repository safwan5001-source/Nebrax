// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const can = vi.hoisted(() => ({ hydrated: true, allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ hydrated: can.hydrated, can: (permission: string) => can.allowed.has(permission) }),
}));

const channel = vi.hoisted(() => ({ readiness: 'active', store: { id: 's1', name: 'Store' } }));
vi.mock('../channel-context', () => ({
  useWholesaleChannel: () => ({ readiness: channel.readiness, store: channel.store }),
}));

import { SectionPage } from './section-page';

function mount(key: Parameters<typeof SectionPage>[0]['sectionKey'], child = vi.fn(() => <p>DATA</p>)) {
  const Child = () => child();
  render(
    <SectionPage sectionKey={key}>
      <Child />
    </SectionPage>,
  );
  return child;
}

describe('SectionPage', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.hydrated = true;
    can.allowed = new Set(['*']);
    channel.readiness = 'active';
    // `*` handled by the mock below: expand to the permissions the sections use.
    can.allowed = new Set(['commerce.orders.view', 'commerce.wholesale.manage', 'commerce.channel_settings.manage', 'products.view', 'invoices.view', 'commerce.manage', 'payments.view']);
  });
  afterEach(cleanup);

  it('mounts children only after hydration and permission', () => {
    can.hydrated = false;
    const child = mount('orders');
    expect(child).not.toHaveBeenCalled();
    expect(screen.queryByText('DATA')).toBeNull();
    expect(screen.queryByText('You do not have access to this section')).toBeNull();
  });

  it('shows a permission-denied state, naming the permission, and never mounts children', () => {
    can.allowed = new Set();
    const child = mount('buyers');
    expect(child).not.toHaveBeenCalled();
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(screen.getByText(/commerce\.wholesale\.manage/)).toBeTruthy();
  });

  it.each([
    ['deployment_off', 'Wholesale is not enabled in this deployment'],
    ['channel_not_marked', 'This channel is not marked as a wholesale channel'],
    ['settings_unavailable', 'Could not determine the wholesale channel status'],
    ['no_channel', 'This store has no sales channel'],
  ])('gates data sections when readiness is %s', (readiness, title) => {
    channel.readiness = readiness;
    const child = mount('orders');
    expect(child).not.toHaveBeenCalled();
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('lets configuration sections render while the deployment switch is off', () => {
    channel.readiness = 'deployment_off';
    mount('priceLists');
    expect(screen.getByText('DATA')).toBeTruthy();
  });

  it('still blocks configuration sections when the store has no channel', () => {
    channel.readiness = 'no_channel';
    const child = mount('priceLists');
    expect(child).not.toHaveBeenCalled();
  });

  it('renders the section title as the page heading (Arabic)', () => {
    locale.current = 'ar';
    mount('buyers');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('المشترون والشركات');
  });

  it('offers the settings shortcut only for an unmarked channel', () => {
    channel.readiness = 'channel_not_marked';
    mount('buyers');
    expect(screen.getByRole('link', { name: 'Open Wholesale settings' }).getAttribute('href')).toContain('/commerce/wholesale/settings');
  });
});
