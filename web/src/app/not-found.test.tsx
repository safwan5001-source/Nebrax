// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import NotFound from './not-found';

afterEach(cleanup);

describe('404 page (ERP-UX-023)', () => {
  it.each([
    ['en', 'Page not found', 'Back to the dashboard'],
    ['ar', 'الصفحة غير موجودة', 'العودة إلى لوحة التحكم'],
  ] as const)('has a main landmark, a localized h1 and a way back in %s', (locale, title, back) => {
    renderIntl(<NotFound />, locale);
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/dashboard');
  });
});
