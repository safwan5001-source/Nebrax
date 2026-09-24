/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderWorkspacePage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    back: 'Back',
    loadFailed: 'Could not load the workspace.',
    savedBadge: 'Saved',
    pagesTitle: 'Pages',
    layersTitle: 'Layers',
    initialPageBadge: 'Home',
    emptyPage: 'Empty page',
    inspectorEmpty: 'Select a component to see its properties.',
    inspectorUnknownType: 'Type "{type}" is not recognized by the registry.',
    propsTitle: 'Properties',
    noProps: 'This component has no properties.',
    actionTitle: 'Action',
    noAction: 'No action',
    injectedParamNote: "Some parameters are injected by the runtime automatically and aren't editable here.",
    addChildTitle: 'Add item',
    addChildPlaceholder: 'Choose an item type',
    addChildAction: 'Add',
    removeComponent: 'Remove this component',
    unsavedBadge: 'Unsaved changes',
    savingBadge: 'Saving…',
    saveSuccessTitle: 'Draft saved',
    saveErrorTitle: 'Could not save the draft',
    undoLabel: 'Undo',
    redoLabel: 'Redo',
    moveUpLabel: 'Move up',
    moveDownLabel: 'Move down',
    dragLabel: 'Drag to reorder',
    mobileStructureTab: 'Structure',
    mobileInspectorTab: 'Properties',
    'device.mobile': 'Mobile',
    'device.tablet': 'Tablet',
    'device.desktop': 'Desktop',
    loading: 'Loading…',
    retry: 'Try again',
    save: 'Save',
    cancel: 'Cancel',
  };
  const cache = new Map<string, ReturnType<typeof buildTranslator>>();
  function buildTranslator(namespace: string) {
    return Object.assign(
      (key: string, values?: Record<string, unknown>) => {
        const full = namespace ? `${namespace}.${key}`.replace(/^appBuilder\.builder\./, '') : key;
        const text = strings[full] ?? strings[key] ?? key;
        return text.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
      },
      { raw: () => ({}) }
    );
  }
  const translator = (namespace: string) => {
    if (!cache.has(namespace)) cache.set(namespace, buildTranslator(namespace));
    return cache.get(namespace)!;
  };
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: (ns: string) => translate(ns), useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'app-1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
const { toastFns } = vi.hoisted(() => ({ toastFns: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toastFns }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const appData = {
  id: 'app-1', name: 'متجري', name_en: 'My App', creation_source: 'scratch' as const,
  latest_published_version: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
};

const draftData = {
  id: 'draft-1', builder_app_id: 'app-1', revision: 0, updated_at: null,
  schema: {
    schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0',
    navigation: { initialPageId: 'home' },
    theme: { tokens: {} },
    pages: {
      home: {
        type: 'Page', id: 'home-root',
        children: [
          {
            type: 'Section', id: 'sec-1', props: { title: 'Featured' },
            children: [
              { type: 'Text', id: 'txt-1', props: { text: 'Welcome' } },
              {
                type: 'ProductCard', id: 'pc-1', props: { title: 'Shoe', amountMinor: 12345 },
                action: { type: 'openProduct', params: { productId: 'p-1' } },
              },
            ],
          },
        ],
      },
    },
  },
};

const registriesData = {
  components: {
    Page: { type: 'Page', version: 1, category: 'layout', props: [], children_rule: { kind: 'unboundedAny', suggested_child_type: null }, actionable: false, injected_runtime_action_params: [], notes: 'Page root.' },
    Section: { type: 'Section', version: 1, category: 'layout', props: [{ key: 'title', type: 'string', required: false, default: null, enum_values: null }], children_rule: { kind: 'unboundedAny', suggested_child_type: null }, actionable: false, injected_runtime_action_params: [], notes: 'Section.' },
    Text: { type: 'Text', version: 1, category: 'content', props: [{ key: 'text', type: 'string', required: false, default: '', enum_values: null }], children_rule: { kind: 'none', suggested_child_type: null }, actionable: false, injected_runtime_action_params: [], notes: 'Text.' },
    ProductCard: {
      type: 'ProductCard', version: 1, category: 'commerce',
      props: [
        { key: 'title', type: 'string', required: true, default: '', enum_values: null },
        { key: 'amountMinor', type: 'amountMinor', required: true, default: 0, enum_values: null },
      ],
      children_rule: { kind: 'none', suggested_child_type: null }, actionable: true, injected_runtime_action_params: [], notes: 'Product card.',
    },
  },
  actions: {
    openProduct: {
      type: 'openProduct', version: 1, risk_class: 'navigation',
      params: [{ key: 'productId', type: 'string', required: true, nullable: false, default: null, min_value: null }],
      dispatch_status: 'provenNoop', notes: 'Opens a product.',
    },
  },
};

function mockApi() {
  api.mockImplementation((path?: string) => {
    // A stray no-argument invocation can occur during Vitest/RTL's own async
    // teardown after a test's assertions already ran (observed empirically,
    // unrelated to this page's real Promise.all(...) call sites, which always
    // pass a concrete path) — resolve harmlessly rather than let it throw and
    // mask the test's real result.
    if (!path) return Promise.resolve({ data: null });
    if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
    if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
    if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

describe('AppBuilderWorkspacePage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    toastFns.success.mockReset();
    toastFns.error.mockReset();
  });

  it('loads the draft and renders the page tree, canvas content, and default selection', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);

    // The preview locale toggle defaults to 'ar', so the header shows the Arabic name —
    // wait on the Section title instead, a locale-independent schema value.
    expect(await screen.findByText('Featured')).toBeTruthy();
    // Layers tree shows every node's type (rendered twice: desktop pane + mobile pane).
    expect(screen.getAllByText('Section').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ProductCard').length).toBeGreaterThan(0);
    // Canvas renders the Text node's content and the formatted price.
    expect(screen.getAllByText('Welcome').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/123\.45/).length).toBeGreaterThan(0);
    // Inspector defaults to the page root's own definition.
    expect(screen.getAllByText('This component has no properties.').length).toBeGreaterThan(0);
  });

  it('selecting a component in the layers tree updates the Inspector with its props and action', async () => {
    mockApi();
    const user = userEvent.setup();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const productCardRows = screen.getAllByText('ProductCard');
    await user.click(productCardRows[0]);

    await waitFor(() => expect(screen.getAllByText('amountMinor').length).toBeGreaterThan(0));
    expect(screen.getAllByText('openProduct').length).toBeGreaterThan(0);
    expect(screen.getAllByText('productId').length).toBeGreaterThan(0);
  });

  it('editing a text prop updates the canvas and marks the draft unsaved', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));

    const textareas = await screen.findAllByDisplayValue('Welcome');
    fireEvent.change(textareas[0], { target: { value: 'Bye' } });

    expect(screen.getAllByText('Bye').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Welcome').length).toBe(0);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('removing the selected component drops it from the canvas and selects its parent', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));

    const removeButtons = await screen.findAllByText('Remove this component');
    await userEvent.setup().click(removeButtons[0]);

    expect(screen.queryAllByText('Bye').length).toBe(0);
    expect(screen.queryAllByText('Welcome').length).toBe(0);
    // Selection moves to the removed node's parent (the Section), which has a `title` prop.
    await waitFor(() => expect(screen.getAllByText('title').length).toBeGreaterThan(0));
  });

  it('the move-down button on a layers-tree row reorders siblings, bounded to the same parent', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    const rowsBefore = within(desktopTree).getAllByRole('treeitem').map((row) => row.textContent);
    expect(rowsBefore.some((text) => text?.includes('Text'))).toBe(true);
    expect(rowsBefore.some((text) => text?.includes('ProductCard'))).toBe(true);
    const textIndexBefore = rowsBefore.findIndex((text) => text?.includes('Text'));
    const productCardIndexBefore = rowsBefore.findIndex((text) => text?.includes('ProductCard'));
    expect(textIndexBefore).toBeLessThan(productCardIndexBefore);

    const [moveDownButton] = within(desktopTree).getAllByLabelText('Move down');
    await userEvent.setup().click(moveDownButton);

    const rowsAfter = within(desktopTree).getAllByRole('treeitem').map((row) => row.textContent);
    const textIndexAfter = rowsAfter.findIndex((text) => text?.includes('Text'));
    const productCardIndexAfter = rowsAfter.findIndex((text) => text?.includes('ProductCard'));
    expect(textIndexAfter).toBeGreaterThan(productCardIndexAfter);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('adding a child to a container selects the new node and marks the draft unsaved', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Section'));

    const [addTypeSelect] = await screen.findAllByDisplayValue('Choose an item type');
    fireEvent.change(addTypeSelect, { target: { value: 'Text' } });
    const [addButton] = screen.getAllByText('Add');
    await userEvent.setup().click(addButton);

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // The new Text node is selected — its (empty-string default) `text` prop field is now visible.
    await waitFor(() => expect(screen.getAllByDisplayValue('').length).toBeGreaterThan(0));
  });

  it('undo reverts the last edit and redo reapplies it', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));
    const textareas = await screen.findAllByDisplayValue('Welcome');
    fireEvent.change(textareas[0], { target: { value: 'Bye' } });
    expect(screen.getAllByText('Bye').length).toBeGreaterThan(0);

    const [undoButton] = screen.getAllByLabelText('Undo');
    await userEvent.setup().click(undoButton);
    await waitFor(() => expect(screen.getAllByText('Welcome').length).toBeGreaterThan(0));

    const [redoButton] = screen.getAllByLabelText('Redo');
    await userEvent.setup().click(redoButton);
    await waitFor(() => expect(screen.getAllByText('Bye').length).toBeGreaterThan(0));
  });

  it('saving calls the draft PUT endpoint and clears the unsaved state', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));
    const textareas = await screen.findAllByDisplayValue('Welcome');
    fireEvent.change(textareas[0], { target: { value: 'Bye' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    const [saveButton] = screen.getAllByText('Save');
    await userEvent.setup().click(saveButton);

    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));
    expect(toastFns.success).toHaveBeenCalled();
  });

  it('shows an error state when loading fails', async () => {
    const { ApiError } = await import('@/lib/api');
    // Reject only the first Promise.all(...) input and resolve the rest — rejecting all three
    // uniformly (mockRejectedValue) creates two additional "unhandled rejection" promise objects
    // that Promise.all itself never awaits individually, which Vitest reports as a spurious
    // failure even though the page's own .catch() correctly handles the aggregate rejection.
    api.mockImplementation((path?: string) => {
      if (path && path.endsWith('/apps/app-1')) return Promise.reject(new ApiError(500, 'Could not load the workspace.', null));
      return Promise.resolve({ data: null });
    });
    render(<AppBuilderWorkspacePage />);

    expect(await screen.findByText('Could not load the workspace.')).toBeTruthy();
  });
});
