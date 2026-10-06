// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
import { ContentSection } from './content-section';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

type Row = Record<string, unknown>;
const block = (type: string, over: Row = {}): Row => ({ block_type: type, body: `نص ${type}`, body_en: null, is_active: true, ...over });

function server(initial: Row[], opts: { rejectSave?: ApiError; canManage?: boolean; noRevision?: boolean; revisionFromSecondRead?: boolean } = {}) {
  let current = initial;
  let reads = 0;
  let readFails = false;
  const writes: { blocks: Row[]; expected_revision?: string }[] = [];
  const revisionOf = (rows: Row[]) => JSON.stringify(rows);
  apiMock.mockImplementation(async (_path: string, options?: { method?: string; body?: { blocks: Row[]; expected_revision?: string } }) => {
    if (options?.method === 'PUT') {
      if (opts.rejectSave) throw opts.rejectSave;
      if (options.body!.expected_revision !== undefined && options.body!.expected_revision !== revisionOf(current)) throw new ApiError(409, 'stale', {});
      writes.push(options.body!);
      current = options.body!.blocks.map((b) => ({ body_en: null, ...b }));
    } else if (readFails) {
      throw new ApiError(500, 'boom', {});
    }
    reads += 1;
    const hidden = opts.noRevision || (opts.revisionFromSecondRead && reads === 1);

    return { data: { blocks: current, ...(hidden ? {} : { revision: revisionOf(current) }) } };
  });
  renderIntl(
    <ToastProvider>
      <ContentSection productId="p1" locale="en" canManage={opts.canManage ?? true} />
    </ToastProvider>,
    'en',
  );

  return { writes, setRemote: (next: Row[]) => { current = next; }, failRead: () => { readFails = true; } };
}

const types = () => Array.from(document.querySelectorAll('[data-content-row]')).map((r) => r.getAttribute('data-content-row'));

describe('ContentSection', () => {
  it('shows an empty state with guidance, then lists blocks in order with excerpt and state', async () => {
    server([]);
    expect(await screen.findByText('No content yet')).toBeTruthy();
    cleanup();
    apiMock.mockReset();
    server([block('composition', { body: 'x'.repeat(300) }), block('care', { is_active: false })]);
    await screen.findByText('Composition');
    expect(types()).toEqual(['composition', 'care']);
    expect(document.querySelector('[data-content-row="composition"]')?.textContent).toContain('…');
    expect(document.querySelector('[data-content-row="care"]')?.textContent).toContain('Off');
  });

  it('adds a block from the closed type list only (used types are not offered) and saves block_type payload', async () => {
    const srv = server([block('composition')]);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add content' }))[0]);
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText('Content type') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).not.toContain('composition');
    expect(options).toHaveLength(9);
    expect(within(dialog).getByText(/How the recipient keeps the product fresh/)).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(within(dialog).getByText('This field is required.')).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Text'), 'تُحفظ في مكان بارد');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].blocks).toEqual([
      { block_type: 'composition', body: 'نص composition', body_en: null, is_active: true },
      { block_type: 'care', body: 'تُحفظ في مكان بارد', body_en: null, is_active: true },
    ]);
    expect(await screen.findByText('All changes saved')).toBeTruthy();
  });

  it('enforces length and line limits with a live counter and an accessible error', async () => {
    const srv = server([]);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add content' }))[0]);
    const dialog = screen.getByRole('dialog');
    const body = within(dialog).getByLabelText('Text');
    fireEvent.change(body, { target: { value: Array.from({ length: 41 }, () => 'a').join('\n') } });
    expect(within(dialog).getByText(/41 \/ 40 lines/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(within(dialog).getByText('Too many lines (maximum 40).')).toBeTruthy();
    expect(body.getAttribute('aria-invalid')).toBe('true');
    expect(body.getAttribute('aria-describedby')).toContain('body-error');

    fireEvent.change(body, { target: { value: 'x'.repeat(2001) } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    expect(within(dialog).getByText('The text is longer than allowed (2000 characters).')).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
  });

  it('edits in place (type locked), toggles active, reorders and removes locally; discard restores', async () => {
    const srv = server([block('composition'), block('care')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit: Care' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Content type') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'جديد' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply to list' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Composition: Active (visible to shoppers)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move up: Care' }));
    expect(types()).toEqual(['care', 'composition']);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].blocks.map((b) => [b.block_type, b.body, b.is_active])).toEqual([['care', 'جديد', true], ['composition', 'نص composition', false]]);

    await userEvent.click(screen.getByRole('button', { name: 'Delete: Care' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(types()).toEqual(['composition']);
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(types()).toEqual(['care', 'composition']);
  });

  it('surfaces a server rejection keeping the draft and never overwrites a remote change', async () => {
    server([block('care')], { rejectSave: new ApiError(422, 'كتلة واحدة فقط لكل نوع محتوى.', {}) });
    await userEvent.click(await screen.findByRole('switch', { name: 'Care: Active (visible to shoppers)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('كتلة واحدة فقط لكل نوع محتوى.')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    cleanup();
    apiMock.mockReset();
    const srv = server([block('care')]);
    await userEvent.click(await screen.findByRole('switch', { name: 'Care: Active (visible to shoppers)' }));
    srv.setRemote([block('care'), block('storage')]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/changed on the server since you opened this page/)).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
    expect(types()).toEqual(['care', 'storage']);
  });

  it('sends the revision it read so the server rejects a stale replacement under its lock', async () => {
    const srv = server([block('care')]);
    await userEvent.click(await screen.findByRole('switch', { name: 'Care: Active (visible to shoppers)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].expected_revision).toBe(JSON.stringify([block('care')]));
  });

  it('after a 409 whose refresh read fails it reports the failure and never writes with the stale revision', async () => {
    const srv = server([block('care')]);
    await userEvent.click(await screen.findByRole('switch', { name: 'Care: Active (visible to shoppers)' }));
    srv.setRemote([block('care'), block('composition')]);
    srv.failRead();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(srv.writes).toHaveLength(0);
  });

  it('without a server revision it falls back to the pre-read and never writes when that read fails', async () => {
    const srv = server([block('care')], { noRevision: true });
    await userEvent.click(await screen.findByRole('switch', { name: 'Care: Active (visible to shoppers)' }));
    srv.failRead();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(srv.writes).toHaveLength(0);
  });

  it('carries the revision returned by the fallback pre-read into the PUT (rolling backend deploy)', async () => {
    const srv = server([block('care')], { revisionFromSecondRead: true });
    await userEvent.click(await screen.findByRole('switch', { name: 'Care: Active (visible to shoppers)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].expected_revision).toBe(JSON.stringify([block('care')]));
  });

  it('is read-only without products.manage', async () => {
    server([block('care')], { canManage: false });
    await userEvent.click(await screen.findByRole('button', { name: 'View input: Care' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Text') as HTMLTextAreaElement).disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: 'Apply to list' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('button', { name: 'Add content' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
