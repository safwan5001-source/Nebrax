// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';
import { FUEL_HELP_ARTICLES, getFuelHelpArticle } from '@/modules/help-center/fuel';

const navigation = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/shifts/open', push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: navigation.push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import { FuelContextualHelp } from './fuel-contextual-help';
import { FuelHelpArticleView } from './fuel-help-article-view';
import { FuelHelpCenter } from './fuel-help-center';

const APP = '/fuel-stations/ops/help';
const ERP = '/fuel-stations/help';

beforeEach(() => { navigation.pathname = '/fuel-stations/ops/shifts/open'; navigation.push.mockReset(); });
afterEach(cleanup);

const hrefs = (root: HTMLElement) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

describe('FuelHelpCenter', () => {
  it.each(TEST_LOCALES)('renders every guide as a link under the surface base path in %s', (locale) => {
    const { container } = renderIntl(<FuelHelpCenter basePath={APP} surface="app" />, locale);
    const links = hrefs(container);
    expect(links).toHaveLength(FUEL_HELP_ARTICLES.length);
    for (const slug of FUEL_HELP_ARTICLES.map((a) => a.slug)) expect(links).toContain(`${APP}/${slug}`);
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getByText(TEST_MESSAGES[locale].fuelHelp.categoriesTitle)).toBeTruthy();
  });

  it('searches quickly in Arabic and shows an empty state with a way back', () => {
    const { container } = renderIntl(<FuelHelpCenter basePath={ERP} surface="erp" />);
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'فتح وردية' } });
    expect(hrefs(container)[0]).toBe(`${ERP}/fuel-open-shift`);
    fireEvent.change(search, { target: { value: 'zzqxwv' } });
    expect(screen.getByText(TEST_MESSAGES.ar.helpCenter.noResults)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: TEST_MESSAGES.ar.helpCenter.showAll })[0]);
    expect(hrefs(container).length).toBe(FUEL_HELP_ARTICLES.length);
  });

  it('filters by audience and preselects the attendant view when asked', () => {
    const { container } = renderIntl(<FuelHelpCenter basePath={APP} surface="app" defaultAudience="operator" />, 'en');
    const links = hrefs(container);
    expect(links).toContain(`${APP}/fuel-open-shift`);
    expect(links).not.toContain(`${APP}/fuel-tanks-pumps-nozzles`);
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES.en.fuelHelp.audienceAll }));
    expect(hrefs(container)).toContain(`${APP}/fuel-tanks-pumps-nozzles`);
  });

  it('opens a category and lists only its guides', () => {
    const { container } = renderIntl(<FuelHelpCenter basePath={APP} surface="app" />, 'en');
    fireEvent.click(screen.getByRole('button', { name: /Shifts/ }));
    const links = hrefs(container);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(getFuelHelpArticle(href.split('/').pop()!)?.category).toBe('shifts');
  });
});

describe('FuelHelpArticleView', () => {
  it.each(TEST_LOCALES)('shows the required parts of a guide in %s', (locale) => {
    const t = TEST_MESSAGES[locale].fuelHelp;
    renderIntl(<FuelHelpArticleView slug="fuel-open-shift" basePath={APP} surface="app" />, locale);
    for (const heading of [t.overview, t.permissionsTitle, t.problemsTitle, t.fieldsTitle]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.getByText('fuel.shift.open')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(8);
  });

  it('never links the app surface outside /fuel-stations/ops, for every guide', () => {
    for (const article of FUEL_HELP_ARTICLES) {
      const { container, unmount } = renderIntl(<FuelHelpArticleView slug={article.slug} basePath={APP} surface="app" />);
      for (const href of hrefs(container)) expect(href.startsWith('/fuel-stations/ops'), `${article.slug}: ${href}`).toBe(true);
      unmount();
    }
  });

  it('links the ERP surface to ERP screens and marks app-only links as such', () => {
    const { container } = renderIntl(<FuelHelpArticleView slug="fuel-open-shift" basePath={ERP} surface="erp" />, 'en');
    expect(hrefs(container)).toContain('/fuel-stations/ops/shifts/open');
    expect(screen.getByText(new RegExp(TEST_MESSAGES.en.fuelHelp.openInApp))).toBeTruthy();
    cleanup();
    const erp = renderIntl(<FuelHelpArticleView slug="fuel-products-prices" basePath={ERP} surface="erp" />, 'en');
    expect(hrefs(erp.container)).toContain('/fuel-stations/prices');
  });

  it('runs the interactive guide one step at a time with progress and a completion state', () => {
    const article = getFuelHelpArticle('fuel-open-shift')!;
    const steps = article.procedures[0].steps;
    renderIntl(<FuelHelpArticleView slug="fuel-open-shift" basePath={APP} surface="app" />);
    fireEvent.click(screen.getAllByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.startGuide })[0]);

    const guide = screen.getByRole('region', { name: TEST_MESSAGES.ar.fuelHelp.guide.title });
    expect(within(guide).getByText(steps[0].ar)).toBeTruthy();
    expect(within(guide).queryByText(steps[1].ar)).toBeNull();
    expect((within(guide).getByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.guide.previous }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(guide).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');

    fireEvent.click(within(guide).getByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.guide.next }));
    expect(within(guide).getByText(steps[1].ar)).toBeTruthy();
    expect(Number(within(guide).getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);

    for (let i = 1; i < steps.length - 1; i += 1) fireEvent.click(within(guide).getByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.guide.next }));
    fireEvent.click(within(guide).getByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.guide.finish }));
    expect(within(guide).getByText(TEST_MESSAGES.ar.fuelHelp.guide.done)).toBeTruthy();
    fireEvent.click(within(guide).getAllByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.guide.exit })[1]);
    expect(screen.queryByRole('region', { name: TEST_MESSAGES.ar.fuelHelp.guide.title })).toBeNull();
  });

  it('reports a missing guide with a way back', () => {
    renderIntl(<FuelHelpArticleView slug="nope" basePath={APP} surface="app" />, 'en');
    expect(screen.getByText(TEST_MESSAGES.en.fuelHelp.articleNotFound)).toBeTruthy();
    expect(screen.getByRole('link', { name: TEST_MESSAGES.en.fuelHelp.backToHelp }).getAttribute('href')).toBe(APP);
  });
});

describe('FuelContextualHelp', () => {
  const className = 'h-11 w-11';

  it.each(TEST_LOCALES)('opens the guide mapped to the current screen with the right direction in %s', (locale) => {
    const t = TEST_MESSAGES[locale].fuelHelp;
    renderIntl(<FuelContextualHelp basePath={APP} surface="app" buttonClassName={className} />, locale);
    fireEvent.click(screen.getByRole('button', { name: t.contextualTitle }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByText(getFuelHelpArticle('fuel-open-shift')!.title[locale])).toBeTruthy();
    expect(screen.getByRole('link', { name: t.openFullArticle }).getAttribute('href')).toBe(`${APP}/fuel-open-shift`);
    expect(dialog.className).toContain('w-full');
  });

  it('shows only the essentials in the sheet and no link leaves the app', () => {
    renderIntl(<FuelContextualHelp basePath={APP} surface="app" buttonClassName={className} />);
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES.ar.fuelHelp.contextualTitle }));
    const dialog = screen.getByRole('dialog');
    for (const href of hrefs(dialog)) expect(href.startsWith('/fuel-stations/ops')).toBe(true);
    expect(within(dialog).queryByText(TEST_MESSAGES.ar.fuelHelp.fieldsTitle)).toBeNull();
  });

  it('sends the button to the Help Center when the screen has no guide', () => {
    navigation.pathname = '/fuel-stations/devices';
    renderIntl(<FuelContextualHelp basePath={ERP} surface="erp" buttonClassName={className} />, 'en');
    fireEvent.click(screen.getByRole('button', { name: TEST_MESSAGES.en.fuelHelp.contextualFallback }));
    expect(navigation.push).toHaveBeenCalledWith(ERP);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
