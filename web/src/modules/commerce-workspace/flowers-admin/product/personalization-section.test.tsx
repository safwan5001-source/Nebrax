// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { PersonalizationSection } from './personalization-section';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

type Row = Record<string, unknown>;
const text = (over: Row = {}): Row => ({ key: 'card-name', type: 'text', label: 'الاسم على البطاقة', label_en: 'Card name', help_text: null, is_required: true, max_length: 20, is_active: true, options: [], ...over });
const select = (over: Row = {}): Row => ({
  key: 'ribbon', type: 'select', label: 'لون الشريط', label_en: null, help_text: null, is_required: false, max_length: null, is_active: true,
  options: [{ value_key: 'red', label: 'أحمر', label_en: 'Red', is_active: true }], ...over,
});

function server(initial: Row[], opts: { rejectSave?: ApiError; canManage?: boolean } = {}) {
  let current = initial;
  const writes: { fields: Row[] }[] = [];
  apiMock.mockImplementation(async (_path: string, options?: { method?: string; body?: { fields: Row[] } }) => {
    if (options?.method === 'PUT') {
      if (opts.rejectSave) throw opts.rejectSave;
      writes.push(options.body!);
      current = options.body!.fields.map((f) => ({ label_en: null, help_text: null, max_length: null, options: [], ...f }));
    }
    return { data: { fields: current } };
  });
  renderIntl(
    <ToastProvider>
      <PersonalizationSection productId="p1" locale="en" canManage={opts.canManage ?? true} />
    </ToastProvider>,
    'en',
  );

  return { writes, setRemote: (next: Row[]) => { current = next; } };
}

describe('PersonalizationSection', () => {
  it('lists fields compactly with type, requirement, limit and the hyphenated key', async () => {
    server([text(), select({ is_active: false })]);
    const rows = await screen.findAllByText(/·/, { selector: 'p' });
    expect(rows.length).toBeGreaterThan(0);
    const list = document.querySelector('[data-personalization-list]') as HTMLElement;
    expect(list.textContent).toContain('الاسم على البطاقة');
    expect(list.textContent).toContain('Short text');
    expect(list.textContent).toContain('up to 20 characters');
    expect(list.textContent).toContain('card-name');
    expect(list.textContent).toContain('1 options');
    expect(list.textContent).toContain('Off');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('shows an empty state and adds a first required text input, saving the exact payload', async () => {
    const srv = server([]);
    expect(await screen.findByText('No personalization inputs')).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Add input' })[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(within(dialog).getByText('This field is required.')).toBeTruthy();

    await userEvent.type(within(dialog).getByLabelText('Input title'), 'الاسم على البطاقة');
    await userEvent.type(within(dialog).getByLabelText('English title (optional)'), 'Card name');
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Required for the shopper' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(srv.writes).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].fields[0]).toEqual({ key: 'field', type: 'text', label: 'الاسم على البطاقة', label_en: 'Card name', help_text: null, is_required: true, max_length: 60, is_active: true });
    expect(await screen.findByText('All changes saved')).toBeTruthy();
    expect(document.querySelector('[data-personalization-row="field"]')?.textContent).not.toContain('new');
  });

  it('builds a select with options; refuses an invalid key and requires at least one option', async () => {
    const srv = server([]);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add input' }))[0]);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Input title'), 'لون الشريط');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Choice list' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(within(dialog).getByText('Add at least one option.')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add option' }));
    await userEvent.type(within(dialog).getByLabelText('Option name 1'), 'أحمر');
    const optionKey = within(dialog).getByLabelText('Identifier 1');
    await userEvent.clear(optionKey);
    await userEvent.type(optionKey, 'Bad Key');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(within(dialog).getAllByText(/lowercase English letters/i).length).toBeGreaterThan(0);
    await userEvent.clear(optionKey);
    await userEvent.type(optionKey, 'red-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].fields[0]).toMatchObject({ type: 'select', is_required: false, options: [{ value_key: 'red-1', label: 'أحمر', label_en: null, is_active: true }] });
    expect('max_length' in srv.writes[0].fields[0]).toBe(false);
  });

  it('locks the key of a saved input and keeps hyphenated keys valid', async () => {
    server([text()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit: الاسم على البطاقة' }));
    const dialog = screen.getByRole('dialog');
    const key = within(dialog).getByLabelText('Identifier') as HTMLInputElement;
    expect(key.value).toBe('card-name');
    expect(key.disabled).toBe(true);
    expect(within(dialog).getByText(/Locked/)).toBeTruthy();
  });

  it('reorders and deletes locally, warns about open carts, and discards back to the saved list', async () => {
    const srv = server([text(), select()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Move up: لون الشريط' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText(/can send that cart back for review/)).toBeTruthy();
    const keys = () => Array.from(document.querySelectorAll('[data-personalization-row]')).map((r) => r.getAttribute('data-personalization-row'));
    expect(keys()).toEqual(['ribbon', 'card-name']);

    await userEvent.click(screen.getByRole('button', { name: 'Delete: لون الشريط' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(keys()).toEqual(['card-name']);
    expect(srv.writes).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(keys()).toEqual(['card-name', 'ribbon']);
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('refuses to save while a field is invalid, and surfaces server rejection keeping the draft', async () => {
    server([text()], { rejectSave: new ApiError(422, 'مفاتيح مُدخَلات التخصيص يجب أن تكون فريدة.', {}) });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit: الاسم على البطاقة' }));
    await userEvent.type(within(screen.getByRole('dialog')).getByLabelText('Input title'), ' 2');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply to list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('مفاتيح مُدخَلات التخصيص يجب أن تكون فريدة.')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('never overwrites definitions another admin changed: refreshes and does not write', async () => {
    const srv = server([text()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete: الاسم على البطاقة' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    srv.setRemote([text(), select()]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/changed on the server since you opened this page/)).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
    expect(document.querySelectorAll('[data-personalization-row]')).toHaveLength(2);
  });

  it('is read-only without products.manage: view only, no add/save/reorder/delete', async () => {
    server([text()], { canManage: false });
    await userEvent.click(await screen.findByRole('button', { name: 'View input: الاسم على البطاقة' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Input title') as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: 'Apply to list' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('button', { name: 'Add input' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete:/ })).toBeNull();
  });
});
