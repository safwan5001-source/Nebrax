import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReportTableViewState } from './report-data-table';
import { parseStoredSavedReportViews, ReportSavedViewsMenu, useSavedReportViews } from './report-saved-views';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const defaultState: ReportTableViewState = { columnVisibility: {}, sorting: [], density: 'compact', pageSize: 25, columnOrder: [], columnSizing: {} };

function SavedViewsHarness({ reportKey, locale = 'en' }: { reportKey: string; locale?: 'en' | 'ar' }) {
  const defaults = useMemo(() => defaultState, []);
  const controller = useSavedReportViews(reportKey, defaults);
  return (
    <>
      <output data-testid="state">{JSON.stringify(controller.viewState)}</output>
      <button type="button" onClick={() => controller.setViewState({ columnVisibility: { 'column-2': false }, sorting: [{ id: 'column-1', desc: true }], density: 'comfortable', pageSize: 50, columnOrder: ['column-2', 'column-1'], columnSizing: { 'column-1': 220, 'column-2': 180 } })}>Modify table</button>
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

  it('migrates version 1 saved views that lack column layout fields without data loss', () => {
    const legacy = JSON.stringify({
      version: 1,
      reportKey: 'sales:customer',
      views: [{
        version: 1,
        id: 'legacy',
        name: 'Legacy view',
        reportKey: 'sales:customer',
        state: { columnVisibility: { 'column-2': false }, sorting: [{ id: 'column-1', desc: false }], density: 'compact', pageSize: 25 },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    expect(parseStoredSavedReportViews(legacy, 'sales:customer')?.[0]?.state).toMatchObject({ columnOrder: [], columnSizing: {}, pageSize: 25 });
  });

  it('rejects corrupted saved column layout safely', () => {
    const corrupt = JSON.stringify({
      version: 1,
      reportKey: 'sales:customer',
      views: [{
        version: 1,
        id: 'corrupt',
        name: 'Corrupt view',
        reportKey: 'sales:customer',
        state: { columnVisibility: {}, sorting: [], density: 'compact', pageSize: 25, columnOrder: ['column-1', 2], columnSizing: { 'column-1': -10 } },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    expect(parseStoredSavedReportViews(corrupt, 'sales:customer')).toBeNull();
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
    const defaultStateText = screen.getByTestId('state').textContent ?? '';
    expect(defaultStateText).toContain('compact');
    expect(defaultStateText).toContain('"columnOrder":[]');
    expect(defaultStateText).toContain('"columnSizing":{}');

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('menuitem', { name: 'Management review' }));
    const restoredState = screen.getByTestId('state').textContent ?? '';
    expect(restoredState).toContain('comfortable');
    expect(restoredState).toContain('"column-2":false');
    expect(restoredState).toContain('"column-1"');
    expect(restoredState).toContain('"pageSize":50');
    expect(restoredState).toContain('"columnOrder":["column-2","column-1"]');
    expect(restoredState).toContain('"columnSizing":{"column-1":220,"column-2":180}');

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename view: Management review' }));
    const nameInput = screen.getByRole('textbox', { name: 'View name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Month end');
    await user.click(screen.getByRole('button', { name: 'Rename view' }));

    await user.click(screen.getByRole('button', { name: 'Views' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete view: Month end' }));
    expect(screen.getByText('Delete this saved view?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await user.click(screen.getByRole('button', { name: 'Views' }));
    expect(screen.getByText('No saved views yet.')).toBeTruthy();
  });

  it('falls back to an empty collection and the default table state when localStorage reads are blocked', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage blocked'); });
    render(<SavedViewsHarness reportKey="sales:customer" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Views' })).toBeTruthy());
    expect(screen.getByTestId('state').textContent).toContain('"density":"compact"');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Views' }));
    expect(screen.getByText('No saved views yet.')).toBeTruthy();
    getItem.mockRestore();
  });

  it('closes the standard menu on Escape, restores trigger focus, and dismisses outside clicks without closing on non-actions inside it', async () => {
    const user = userEvent.setup();
    render(<SavedViewsHarness reportKey="sales:customer" />);
    const trigger = screen.getByRole('button', { name: 'Views' });

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await user.click(within(screen.getByRole('menu')).getByText('No saved views yet.'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the menu before opening the save dialog', async () => {
    const user = userEvent.setup();
    render(<SavedViewsHarness reportKey="sales:customer" />);
    const trigger = screen.getByRole('button', { name: 'Views' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Save current view' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog', { name: 'Save view' })).toBeTruthy();
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
