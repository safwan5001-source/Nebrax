import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useMemo } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReportTableViewState } from './report-data-table';
import { parseStoredSavedReportViews, ReportSavedViewsMenu, useSavedReportViews } from './report-saved-views';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const defaultState: ReportTableViewState = { columnVisibility: {}, sorting: [], density: 'compact', pageSize: 25 };

function SavedViewsHarness({ reportKey, locale = 'en' }: { reportKey: string; locale?: 'en' | 'ar' }) {
  const defaults = useMemo(() => defaultState, []);
  const controller = useSavedReportViews(reportKey, defaults);
  return (
    <>
      <output data-testid="state">{JSON.stringify(controller.viewState)}</output>
      <button type="button" onClick={() => controller.setViewState({ columnVisibility: { 'column-2': false }, sorting: [{ id: 'column-1', desc: true }], density: 'comfortable', pageSize: 50 })}>Modify table</button>
      {controller.loaded && <ReportSavedViewsMenu controller={controller} locale={locale} />}
    </>
  );
}

describe('Saved report views persistence', () => {
  it('rejects malformed and unknown-version local persistence safely', () => {
    expect(parseStoredSavedReportViews('{not-json', 'sales:customer')).toBeNull();
    expect(parseStoredSavedReportViews(JSON.stringify({ version: 99, reportKey: 'sales:customer', views: [] }), 'sales:customer')).toBeNull();
    expect(parseStoredSavedReportViews(JSON.stringify({ version: 1, reportKey: 'sales:customer', views: [{ version: 1, id: 'bad', name: 'Bad', reportKey: 'sales:customer', state: { columnVisibility: {}, sorting: [], density: 'wide', pageSize: 25 }, createdAt: 'now', updatedAt: 'now' }] }), 'sales:customer')).toBeNull();
  });

  it('creates, applies, renames, and deletes a saved table-only view with validation', async () => {
    const user = userEvent.setup();
    render(<SavedViewsHarness reportKey="sales:customer" />);

    await user.click(screen.getByRole('button', { name: 'Modify table' }));
    expect(screen.getByTestId('state').textContent).toContain('comfortable');

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(screen.getByText('Enter a view name.')).toBeTruthy();

    await user.type(screen.getByRole('textbox', { name: 'View name' }), '  Management review  ');
    await user.click(screen.getByRole('button', { name: 'Save view' }));

    await user.click(screen.getByRole('button', { name: 'Views' }));
    expect(screen.getByRole('menuitem', { name: 'Management review' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: 'Default view' }));
    expect(screen.getByTestId('state').textContent).toContain('compact');

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('menuitem', { name: 'Management review' }));
    const restoredState = screen.getByTestId('state').textContent ?? '';
    expect(restoredState).toContain('comfortable');
    expect(restoredState).toContain('"column-2":false');
    expect(restoredState).toContain('"column-1"');
    expect(restoredState).toContain('"pageSize":50');

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('button', { name: 'Rename view: Management review' }));
    const nameInput = screen.getByRole('textbox', { name: 'View name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Month end');
    await user.click(screen.getByRole('button', { name: 'Rename view' }));

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('button', { name: 'Delete view: Month end' }));
    expect(screen.getByText('Delete this saved view?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await user.click(screen.getByRole('button', { name: 'Views' }));
    expect(screen.getByText('No saved views yet.')).toBeTruthy();
  });

  it('keeps saved views isolated by stable reportKey and renders Arabic labels', async () => {
    const user = userEvent.setup();
    const first = render(<SavedViewsHarness reportKey="sales:customer" />);
    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    await user.type(screen.getByRole('textbox', { name: 'View name' }), 'Customer review');
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    first.unmount();

    render(<SavedViewsHarness reportKey="inventory:value" locale="ar" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'طرق العرض' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'طرق العرض' }));
    expect(screen.getByText('لا توجد عروض محفوظة بعد.')).toBeTruthy();
  });
});
