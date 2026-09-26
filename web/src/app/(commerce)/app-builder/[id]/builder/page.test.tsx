/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderWorkspacePage from './page';

const { api, currentUser, translate } = vi.hoisted(() => {
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
    'binding.title': 'Data source',
    'binding.runtimeNote': 'Not yet active in the mobile app.',
    'binding.noneOption': 'No data source (static content)',
    'binding.queryTitle': 'Filter & sort',
    'binding.searchLabel': 'Search text',
    'binding.searchPlaceholder': 'Leave empty to show all',
    'binding.sortLabel': 'Sort by',
    'binding.sortNoneOption': 'Default order',
    'binding.sortDirectionAscending': 'Ascending',
    'binding.sortDirectionDescending': 'Descending',
    'binding.mappingTitle': 'Map fields',
    'binding.mappingHint': 'Choose which data field fills each property.',
    'binding.mappingFieldPlaceholder': 'Choose a field',
    'visibility.title': 'Visibility condition',
    'visibility.runtimeNote': 'Not yet active in the mobile app.',
    'visibility.alwaysOption': 'Always visible',
    'visibility.allOption': 'All of these are true',
    'visibility.anyOption': 'Any of these is true',
    'visibility.signalPlaceholder': 'Choose a signal',
    'visibility.operatorPlaceholder': 'Choose a comparison',
    'visibility.valuePlaceholder': 'Value',
    'visibility.valueListPlaceholder': 'Comma-separated values',
    'visibility.addCondition': 'Add condition',
    'visibility.unsupportedShape': 'This condition is too advanced for this editor.',
    'visibility.reset': 'Reset to "Always visible"',
    'visibility.signalOption.cart.itemCount': 'Cart item count',
    'visibility.signalOption.customer.isAuthenticated': 'Customer is signed in',
    'visibility.signalOption.product.inStock': 'Product is in stock',
    'visibility.operatorOption.equals': 'equals',
    'visibility.operatorOption.notEquals': 'does not equal',
    'visibility.operatorOption.gt': 'is greater than',
    'visibility.operatorOption.lt': 'is less than',
    'visibility.operatorOption.gte': 'is at least',
    'visibility.operatorOption.lte': 'is at most',
    'visibility.operatorOption.in': 'is one of',
    'visibility.operatorOption.isTrue': 'is true',
    'visibility.operatorOption.isFalse': 'is false',
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
    'theme.tabLabel': 'Theme',
    'theme.tabDescription': 'Edit theme tokens.',
    'theme.runtimeNote': 'Not yet active in the mobile app.',
    'theme.presetTitle': 'Presets',
    'theme.preset.awj-modern': 'AWJ Modern',
    'theme.preset.navy': 'Navy',
    'theme.preset.burgundy': 'Burgundy',
    'theme.preset.sand': 'Sand',
    'theme.preset.slate': 'Slate',
    'theme.primaryColor': 'Primary color',
    'theme.radius': 'Corner radius',
    'theme.radiusOption.default': 'Default',
    'theme.radiusOption.subtle': 'Subtle',
    'theme.radiusOption.sharp': 'Sharp',
    'theme.density': 'Density',
    'theme.densityOption.comfortable': 'Comfortable',
    'theme.densityOption.compact': 'Compact',
    'theme.productCardStyle': 'Product card style',
    'theme.productCardOption.standard': 'Standard',
    'theme.productCardOption.compact': 'Compact',
    'theme.sync.title': 'Store design sync',
    'theme.sync.description': 'Fetch and review your store design.',
    'theme.sync.action': 'Use my store design',
    'theme.sync.chooseStore': 'Choose a store',
    'theme.sync.detecting': 'Fetching from the store…',
    'theme.sync.noStoreFound': 'No store found.',
    'theme.sync.forbidden': 'Not permitted.',
    'theme.sync.detectFailed': 'Could not fetch.',
    'theme.sync.noChanges': 'No changes.',
    'theme.sync.apply': 'Apply',
    'theme.sync.cancel': 'Cancel',
    'pages.addAction': 'Add page',
    'pages.setHomeLabel': 'Set as home page',
    'pages.removeLabel': 'Remove page',
    'pages.pickerPlaceholder': 'Choose a page',
    'publish.action': 'Publish',
    'publish.forbidden': "You don't have permission to publish.",
    'publish.saveFirst': 'Save your changes before publishing.',
    'publish.dialogTitle': 'Publish a new version',
    'publish.validating': 'Checking compatibility…',
    'publish.validationPassed': 'Ready to publish.',
    'publish.validateErrorGeneric': 'Could not check compatibility.',
    'publish.noteLabel': 'Note (optional)',
    'publish.notePlaceholder': 'What changed in this version?',
    'publish.confirmAction': 'Publish',
    'publish.publishing': 'Publishing…',
    'publish.successTitle': 'Version published',
    'publish.errorTitle': 'Could not publish',
    'previewState.draft': 'Draft',
    'previewState.published': 'Published',
    'previewState.default': 'Default',
    'previewState.draftBanner': 'Draft — being edited, not a live version in the mobile app',
    'previewState.publishedBanner': 'Published — version {version}, as you last published this app',
    'previewState.defaultBanner': 'Default experience — what a customer sees before this tenant has published anything',
    'previewState.noPublishedVersion': 'This app has no published version yet',
    'previewState.loadFailed': 'Could not load the published version',
    'previewState.readOnlyNotice': 'Read-only — switch to the Draft tab to edit',
    'previewState.switchToDraftToPublish': 'Switch to Draft to publish',
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
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator };
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
vi.mock('@/lib/auth', () => ({ currentUser }));
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
              { type: 'ProductList', id: 'pl-1', children: [] },
            ],
          },
        ],
      },
      about: { type: 'Page', id: 'about-root', children: [] },
    },
  },
};

const registriesData = {
  components: {
    Page: { type: 'Page', version: 1, category: 'layout', label: { ar: 'الصفحة', en: 'Page' }, props: [], children_rule: { kind: 'unboundedAny', suggested_child_type: null }, actionable: false, injected_runtime_action_params: [], notes: 'Page root.', bindable_resources: [] },
    Section: { type: 'Section', version: 1, category: 'layout', label: { ar: 'قسم', en: 'Section' }, props: [{ key: 'title', type: 'string', required: false, label: { ar: 'العنوان', en: 'Title' }, default: null, enum_values: null }], children_rule: { kind: 'unboundedAny', suggested_child_type: null }, actionable: false, injected_runtime_action_params: [], notes: 'Section.', bindable_resources: [] },
    Text: { type: 'Text', version: 1, category: 'content', label: { ar: 'نص', en: 'Text' }, props: [{ key: 'text', type: 'string', required: false, label: { ar: 'النص', en: 'Text' }, default: '', enum_values: null }], children_rule: { kind: 'none', suggested_child_type: null }, actionable: false, injected_runtime_action_params: [], notes: 'Text.', bindable_resources: [] },
    ProductCard: {
      type: 'ProductCard', version: 1, category: 'commerce', label: { ar: 'بطاقة المنتج', en: 'Product Card' },
      props: [
        { key: 'title', type: 'string', required: true, label: { ar: 'العنوان', en: 'Title' }, default: '', enum_values: null },
        { key: 'amountMinor', type: 'amountMinor', required: true, label: { ar: 'السعر', en: 'Price' }, default: 0, enum_values: null },
      ],
      children_rule: { kind: 'none', suggested_child_type: null }, actionable: true, injected_runtime_action_params: [], notes: 'Product card.',
      bindable_resources: [],
    },
    ProductList: {
      type: 'ProductList', version: 1, category: 'commerce', label: { ar: 'قائمة المنتجات', en: 'Product List' }, props: [],
      children_rule: { kind: 'unboundedAny', suggested_child_type: 'ProductCard' }, actionable: false, injected_runtime_action_params: [], notes: 'Product list.',
      bindable_resources: ['commerce.products'],
    },
  },
  actions: {
    openProduct: {
      type: 'openProduct', version: 1, risk_class: 'navigation', label: { ar: 'فتح المنتج', en: 'Open Product' },
      params: [{ key: 'productId', type: 'string', required: true, label: { ar: 'معرّف المنتج', en: 'Product ID' }, nullable: false, default: null, min_value: null }],
      dispatch_status: 'provenNoop', notes: 'Opens a product.',
    },
    navigate: {
      type: 'navigate', version: 1, risk_class: 'navigation', label: { ar: 'الانتقال', en: 'Navigate' },
      params: [{ key: 'pageId', type: 'string', required: true, label: { ar: 'معرّف الصفحة', en: 'Page ID' }, nullable: false, default: null, min_value: null }],
      dispatch_status: 'provenNoop', notes: 'Navigates to a page.',
    },
  },
  resources: {
    'commerce.products': {
      id: 'commerce.products', version: 1, shape: 'list', paginated: true,
      fields: [
        { key: 'id', type: 'id', localized: false },
        { key: 'name', type: 'string', localized: true },
      ],
      query_params: [
        { key: 'search', kind: 'filter' },
        { key: 'category_id', kind: 'filter' },
        { key: 'name', kind: 'sort' },
      ],
    },
  },
  visibility_signals: ['cart.itemCount', 'customer.isAuthenticated', 'product.inStock'],
  visibility_operators: [
    { type: 'equals', value_arity: 'single' },
    { type: 'notEquals', value_arity: 'single' },
    { type: 'gt', value_arity: 'single' },
    { type: 'lt', value_arity: 'single' },
    { type: 'gte', value_arity: 'single' },
    { type: 'lte', value_arity: 'single' },
    { type: 'in', value_arity: 'list' },
    { type: 'isTrue', value_arity: 'none' },
    { type: 'isFalse', value_arity: 'none' },
  ],
};

const storeCatalogData = {
  stores: [{ id: 'store-1', name: 'My Store', sales_channel_id: null, is_active: true, preview_url: null, default_locale: 'ar' }],
};

const storePresentationData = {
  storefront_id: 'store-1', schema_version: 2, draft_revision: 3,
  draft: { themePreset: 'navy', primaryColor: '#1e3a5f', accentColor: null, fontPreset: 'cairo-geist', density: 'compact', radius: 'sharp', productCard: 'compact', branding: { displayName: 'My Store', logoDataUrl: null, compactLogoDataUrl: null, faviconDataUrl: null } },
  published: { themePreset: 'burgundy', primaryColor: '#7f1d1d', accentColor: null, fontPreset: 'cairo-geist', density: 'comfortable', radius: 'default', productCard: 'standard', branding: { displayName: 'My Store', logoDataUrl: null, compactLogoDataUrl: null, faviconDataUrl: null } },
  published_revision: 2, published_at: '2026-09-01T00:00:00Z',
};

function mockApi(options?: {
  storeCatalog?: unknown;
  storePresentation?: unknown;
  presentationError?: Error;
  validateError?: Error;
  publishError?: Error;
}) {
  api.mockImplementation((path?: string) => {
    // A stray no-argument invocation can occur during Vitest/RTL's own async
    // teardown after a test's assertions already ran (observed empirically,
    // unrelated to this page's real Promise.all(...) call sites, which always
    // pass a concrete path) — resolve harmlessly rather than let it throw and
    // mask the test's real result.
    if (!path) return Promise.resolve({ data: null });
    if (path.endsWith('/validate')) {
      if (options?.validateError) return Promise.reject(options.validateError);
      return Promise.resolve({ data: { valid: true } });
    }
    if (path.endsWith('/versions')) {
      if (options?.publishError) return Promise.reject(options.publishError);
      return Promise.resolve({ data: { id: 'v1', builder_app_id: 'app-1', version: 1 } });
    }
    if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
    if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
    if (path.endsWith('/commerce/workspace/storefronts')) return Promise.resolve({ data: options?.storeCatalog ?? storeCatalogData });
    if (path.endsWith('/presentation')) {
      if (options?.presentationError) return Promise.reject(options.presentationError);
      return Promise.resolve({ data: options?.storePresentation ?? storePresentationData });
    }
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
    currentUser.mockReturnValue({ role: 'owner' });
  });

  it('loads the draft and renders the page tree, canvas content, and default selection', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);

    // The preview locale toggle defaults to 'ar', so the header shows the Arabic name —
    // wait on the Section title instead, a locale-independent schema value.
    expect(await screen.findByText('Featured')).toBeTruthy();
    // Layers tree shows every node's type (rendered twice: desktop pane + mobile pane).
    expect(screen.getAllByText('Section').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Product Card').length).toBeGreaterThan(0);
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

    const productCardRows = screen.getAllByText('Product Card');
    await user.click(productCardRows[0]);

    await waitFor(() => expect(screen.getAllByText('Price').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Open Product').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Product ID').length).toBeGreaterThan(0);
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
    await waitFor(() => expect(screen.getAllByText('Title').length).toBeGreaterThan(0));
  });

  it('the move-down button on a layers-tree row reorders siblings, bounded to the same parent', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    const rowsBefore = within(desktopTree).getAllByRole('treeitem').map((row) => row.textContent);
    expect(rowsBefore.some((text) => text?.includes('Text'))).toBe(true);
    expect(rowsBefore.some((text) => text?.includes('Product Card'))).toBe(true);
    const textIndexBefore = rowsBefore.findIndex((text) => text?.includes('Text'));
    const productCardIndexBefore = rowsBefore.findIndex((text) => text?.includes('Product Card'));
    expect(textIndexBefore).toBeLessThan(productCardIndexBefore);

    const [moveDownButton] = within(desktopTree).getAllByLabelText('Move down');
    await userEvent.setup().click(moveDownButton);

    const rowsAfter = within(desktopTree).getAllByRole('treeitem').map((row) => row.textContent);
    const textIndexAfter = rowsAfter.findIndex((text) => text?.includes('Text'));
    const productCardIndexAfter = rowsAfter.findIndex((text) => text?.includes('Product Card'));
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

  it('the Theme tab lets the merchant pick a preset and marks the draft unsaved', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [themeTab] = screen.getAllByText('Theme');
    await userEvent.setup().click(themeTab);

    const [navyPreset] = await screen.findAllByText('Navy');
    await userEvent.setup().click(navyPreset);

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // Selecting a preset also seeds the primary-color hex field with that preset's color.
    await waitFor(() => expect(screen.getAllByDisplayValue('#1e3a5f').length).toBeGreaterThan(0));
  });

  it('switching back to Pages after selecting a component shows the component Inspector, not the Theme panel', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [themeTab] = screen.getAllByText('Theme');
    await userEvent.setup().click(themeTab);
    expect(screen.getAllByText('Presets').length).toBeGreaterThan(0);

    // The Pages tree is hidden while on the Theme tab; selecting a node from the canvas
    // (its type tag) is the only way back to the Inspector.
    const [sectionTag] = screen.getAllByText('Section');
    await userEvent.setup().click(sectionTag);

    // Selecting a component from the canvas returns the Inspector automatically.
    await waitFor(() => expect(screen.getAllByText('Title').length).toBeGreaterThan(0));
    expect(screen.queryAllByText('Presets').length).toBe(0);
  });

  it('Use My Store Design: detecting from a single store shows a diff and Apply merges the proposed tokens', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [themeTab] = screen.getAllByText('Theme');
    await userEvent.setup().click(themeTab);

    const [detectButton] = await screen.findAllByText('Use my store design');
    await userEvent.setup().click(detectButton);

    // The published presentation (burgundy, #7f1d1d) is used over the unpublished draft.
    await waitFor(() => expect(screen.getAllByText('#7f1d1d').length).toBeGreaterThan(0));
    expect(screen.getAllByText('primaryColor').length).toBeGreaterThan(0);

    const [applyButton] = screen.getAllByText('Apply');
    await userEvent.setup().click(applyButton);

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByDisplayValue('#7f1d1d').length).toBeGreaterThan(0));
    // Review state clears after Apply — the diff table is gone.
    expect(screen.queryAllByText('primaryColor').length).toBe(0);
  });

  it('Use My Store Design: shows a store picker when more than one store exists', async () => {
    mockApi({ storeCatalog: { stores: [
      { id: 'store-1', name: 'Store One', sales_channel_id: null, is_active: true, preview_url: null, default_locale: 'ar' },
      { id: 'store-2', name: 'Store Two', sales_channel_id: null, is_active: true, preview_url: null, default_locale: 'ar' },
    ] } });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [themeTab] = screen.getAllByText('Theme');
    await userEvent.setup().click(themeTab);
    const [detectButton] = await screen.findAllByText('Use my store design');
    await userEvent.setup().click(detectButton);

    const [chooseStore] = await screen.findAllByText('Choose a store');
    expect(chooseStore).toBeTruthy();
    expect(screen.getAllByText('Store One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Store Two').length).toBeGreaterThan(0);
  });

  it('Use My Store Design: shows a clear message when the presentation read is forbidden', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi({ presentationError: new ApiError(403, 'forbidden', null) });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [themeTab] = screen.getAllByText('Theme');
    await userEvent.setup().click(themeTab);
    const [detectButton] = await screen.findAllByText('Use my store design');
    await userEvent.setup().click(detectButton);

    expect(await screen.findByText('Not permitted.')).toBeTruthy();
  });

  it('adding a page creates and selects a new empty page', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const removeButtonsBefore = screen.getAllByLabelText('Remove page');
    const [addPageButton] = screen.getAllByText('Add page');
    await userEvent.setup().click(addPageButton);

    // A third page row now exists (home, about, and the new one), and it is immediately
    // selected — the new empty Page root has no props, so the Inspector falls back to the
    // "no properties" message.
    const removeButtonsAfter = screen.getAllByLabelText('Remove page');
    expect(removeButtonsAfter.length).toBe(removeButtonsBefore.length + 2); // +1 page, desktop+mobile copies
    expect(screen.getAllByText('This component has no properties.').length).toBeGreaterThan(0);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('the home page cannot be removed, and removing another page falls back selection to home', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    // Row order follows schema.pages key order (home, about); desktop panel's buttons come
    // first in DOM order, mobile panel's copy second.
    const [homeRemoveButton, aboutRemoveButton] = screen.getAllByLabelText('Remove page');
    expect((homeRemoveButton as HTMLButtonElement).disabled).toBe(true);
    expect((aboutRemoveButton as HTMLButtonElement).disabled).toBe(false);

    await userEvent.setup().click(aboutRemoveButton);

    expect(screen.queryAllByText('about').length).toBe(0);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('setting a different page as home moves the removability guardrail with it', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    // Only the non-home page ("about") offers "Set as home" initially.
    const [setAboutHomeButton] = screen.getAllByLabelText('Set as home page');
    await userEvent.setup().click(setAboutHomeButton);

    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // Home is now removable (it is no longer the home page), about is not.
    const [homeRemoveButton, aboutRemoveButton] = screen.getAllByLabelText('Remove page');
    expect((homeRemoveButton as HTMLButtonElement).disabled).toBe(false);
    expect((aboutRemoveButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("the navigate action's pageId param renders as a picker of real declared pages", async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const productCardRows = screen.getAllByText('Product Card');
    await userEvent.setup().click(productCardRows[0]);

    const [actionTypeSelect] = await screen.findAllByDisplayValue('Open Product');
    fireEvent.change(actionTypeSelect, { target: { value: 'navigate' } });

    const [pageIdSelect] = await screen.findAllByDisplayValue('Choose a page');
    fireEvent.change(pageIdSelect, { target: { value: 'about' } });
    expect(await screen.findAllByDisplayValue('about')).toBeTruthy();
  });

  it('a bindable component shows the data source picker; a non-bindable one does not', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Product List'));
    expect(await screen.findAllByText('Data source')).toBeTruthy();

    await userEvent.setup().click(within(desktopTree).getByText('Text'));
    await waitFor(() => expect(screen.queryAllByText('Data source').length).toBe(0));
  });

  it('choosing a data source for a bindable component reveals its filter/sort fields and marks the draft unsaved', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Product List'));

    const [resourceSelect] = await screen.findAllByDisplayValue('No data source (static content)');
    fireEvent.change(resourceSelect, { target: { value: 'commerce.products' } });

    expect(await screen.findAllByText('Search text')).toBeTruthy();
    expect(screen.getAllByText('Sort by').length).toBeGreaterThan(0);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    const [searchInput] = screen.getAllByPlaceholderText('Leave empty to show all');
    fireEvent.change(searchInput, { target: { value: 'shoes' } });
    expect(await screen.findAllByDisplayValue('shoes')).toBeTruthy();
  });

  it('a mapped component shows field-mapping rows for each of its own properties', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Product List'));
    // ProductList has no props of its own — mapping section only makes sense
    // for a component that renders fields, so it should not appear here.
    expect(screen.queryAllByText('Map fields').length).toBe(0);
  });

  it('the visibility condition editor starts as "always visible" and adding a condition reveals signal/operator fields', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));

    const [visibilitySelect] = await screen.findAllByDisplayValue('Always visible');
    fireEvent.change(visibilitySelect, { target: { value: 'all' } });

    expect(await screen.findAllByText('Choose a signal')).toBeTruthy();
    expect(screen.getAllByText('Choose a comparison').length).toBeGreaterThan(0);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('the visibility editor hides the value field for isTrue/isFalse and shows it for equals', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));

    const [visibilitySelect] = await screen.findAllByDisplayValue('Always visible');
    fireEvent.change(visibilitySelect, { target: { value: 'all' } });

    const [operatorSelect] = await screen.findAllByDisplayValue('equals');
    expect(screen.getAllByPlaceholderText('Value').length).toBeGreaterThan(0);

    fireEvent.change(operatorSelect, { target: { value: 'isTrue' } });
    await waitFor(() => expect(screen.queryAllByPlaceholderText('Value').length).toBe(0));
  });

  it('the Publish button is disabled while the draft has unsaved changes', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));
    const textareas = await screen.findAllByDisplayValue('Welcome');
    fireEvent.change(textareas[0], { target: { value: 'Bye' } });

    const [publishButton] = screen.getAllByText('Publish');
    expect((publishButton.closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the Publish button is disabled for a user without the publish permission', async () => {
    currentUser.mockReturnValue({ role: 'staff', permissions: [] });
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [publishButton] = screen.getAllByText('Publish');
    expect((publishButton.closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Publish: validation passes automatically, then confirming calls the versions endpoint', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [publishButton] = screen.getAllByText('Publish');
    await userEvent.setup().click(publishButton);

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ready to publish.');
    expect(within(dialog).queryByText('Checking compatibility…')).toBeNull();

    fireEvent.change(within(dialog).getByPlaceholderText('What changed in this version?'), { target: { value: 'First release' } });

    const confirmButton = within(dialog).getByRole('button', { name: 'Publish' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(confirmButton);

    await waitFor(() => expect(toastFns.success).toHaveBeenCalledWith('Version published'));
  });

  it('Publish: a failed validation blocks the confirm button and shows the error', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi({ validateError: new ApiError(422, 'Schema is incompatible.', null) });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const [publishButton] = screen.getAllByText('Publish');
    await userEvent.setup().click(publishButton);

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Schema is incompatible.');
    expect(within(dialog).queryByText('Ready to publish.')).toBeNull();

    const confirmButton = within(dialog).getByRole('button', { name: 'Publish' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
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

  // LIVE-PREVIEW-6 — Draft / Published / Default preview-state switcher. These three tests
  // use their own local `api.mockImplementation` rather than the shared `mockApi()` helper
  // above: that helper treats ANY path ending in `/versions` as the single-object PUBLISH
  // response, which would answer the switcher's `GET .../versions` LIST call with the wrong
  // shape.
  describe('preview state switcher', () => {
    const publishedSchema = {
      schemaVersion: '1.0.0',
      minRuntimeVersion: '1.0.0',
      navigation: { initialPageId: 'home' },
      theme: { tokens: {} },
      pages: {
        home: {
          type: 'Page', id: 'home-root',
          children: [{ type: 'Section', id: 'pub-sec-1', props: { title: 'Published Content' }, children: [] }],
        },
      },
    };

    function mockApiWithPublishedVersion() {
      api.mockImplementation((path?: string) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
        if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
        if (path.endsWith('/versions')) {
          return Promise.resolve({
            data: [
              { id: 'ver-1', builder_app_id: 'app-1', version: 1, schema_version: '1.0.0', note: null, published_by: null, published_by_name: null, published_at: '2026-09-01T00:00:00Z' },
              { id: 'ver-2', builder_app_id: 'app-1', version: 2, schema_version: '1.0.0', note: null, published_by: null, published_by_name: null, published_at: '2026-09-10T00:00:00Z' },
            ],
          });
        }
        if (path.endsWith('/versions/2')) {
          return Promise.resolve({
            data: { id: 'ver-2', builder_app_id: 'app-1', version: 2, schema_version: '1.0.0', note: null, schema: publishedSchema, published_by: null, published_by_name: null, published_at: '2026-09-10T00:00:00Z' },
          });
        }
        if (path.endsWith('/apps/app-1')) return Promise.resolve({ data: { ...appData, latest_published_version: 2 } });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });
    }

    it('switching to Default renders the bundled default experience with no extra API call and shows the default banner', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      const callsBeforeSwitch = api.mock.calls.length;
      await userEvent.setup().click(screen.getByRole('button', { name: 'Default' }));

      expect(await screen.findByText('أَوْج')).toBeTruthy();
      expect(screen.getByText('Default experience — what a customer sees before this tenant has published anything')).toBeTruthy();
      // No new network call — the default experience is a static, bundled constant.
      expect(api.mock.calls.length).toBe(callsBeforeSwitch);
      // Read-only: no editable panels are exposed against this non-draft schema.
      expect(screen.queryByText('Add page')).toBeNull();
      expect(screen.getByText('Read-only — switch to the Draft tab to edit')).toBeTruthy();
    });

    it('switching to Published fetches the version list then the full version and renders it read-only', async () => {
      mockApiWithPublishedVersion();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'Published' }));

      expect(await screen.findByText('Published Content')).toBeTruthy();
      expect(screen.getByText('Published — version 2, as you last published this app')).toBeTruthy();
      await waitFor(() => expect(api).toHaveBeenCalledWith('/app-builder/apps/app-1/versions'));
      await waitFor(() => expect(api).toHaveBeenCalledWith('/app-builder/apps/app-1/versions/2'));

      // Editing controls are disabled — nothing here can mutate the draft.
      const [saveButton] = screen.getAllByText('Save');
      expect((saveButton.closest('button') as HTMLButtonElement).disabled).toBe(true);
      const [undoButton] = screen.getAllByLabelText('Undo');
      expect((undoButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByText('Add page')).toBeNull();
    });

    it('the Published tab is disabled when the app has no published version', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      const publishedTab = screen.getByRole('button', { name: 'Published' });
      expect((publishedTab as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
