// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';
import { HelpArticle } from './help-article';

afterEach(cleanup);

describe('HelpArticle', () => {
  it.each(TEST_LOCALES)('renders the existing article structure and navigation in %s', (locale) => {
    const title = locale === 'ar' ? 'تنفيذ جرد مخزني' : 'Run a stocktake';
    const direction = locale === 'ar' ? 'rtl' : 'ltr';
    const { container } = renderIntl(
      <div dir={direction}>
        <HelpArticle slug="run-stocktake" />
      </div>,
      locale
    );

    expect(container.firstElementChild?.getAttribute('dir')).toBe(direction);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: TEST_MESSAGES[locale].helpCenter.backToHelp }).getAttribute('href')).toBe('/help');
    expect(screen.getByRole('link', { name: locale === 'ar' ? 'بدء جرد' : 'Start stocktake' }).getAttribute('href')).toBe('/stocktaking/new');
  });

  it.each(TEST_LOCALES)('renders a safe explicit not-found state in %s', (locale) => {
    renderIntl(<HelpArticle slug="not-a-help-article" />, locale);

    expect(screen.getByRole('heading', { level: 1, name: TEST_MESSAGES[locale].helpCenter.articleNotFound })).toBeTruthy();
    expect(screen.getByText(TEST_MESSAGES[locale].helpCenter.articleNotFoundHint)).toBeTruthy();
    expect(screen.getByRole('link', { name: TEST_MESSAGES[locale].helpCenter.backToHelp }).getAttribute('href')).toBe('/help');
  });
});
