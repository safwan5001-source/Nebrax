/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    'publish.draftChangedTitle': 'The draft changed',
    'publish.draftChangedBody': 'Nothing was published. Reload and review.',
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
    // AD-01 / S01b — save safety
    saveNetworkHint: 'Server unreachable',
    'conflict.title': 'Draft save conflict',
    'conflict.body': 'Saved elsewhere (version {current}) after you opened version {base}.',
    'conflict.lastSaved': 'Last saved: {when}',
    'conflict.safeNote': 'Your changes are kept.',
    'conflict.changedAgain': 'The draft changed again.',
    'conflict.keepEditing': 'Keep editing',
    'conflict.copyMine': 'Copy my changes',
    'conflict.reload': 'Load the saved draft',
    'conflict.overwrite': 'Overwrite the saved draft',
    'conflict.checkingLatest': 'Fetching the latest version…',
    'conflict.confirmReloadBody': 'Replace with version {current} and discard my changes.',
    'conflict.confirmReloadAction': 'Load and discard my changes',
    'conflict.confirmOverwriteBody': 'Replace saved version {latest} with my changes.',
    'conflict.overwriteWarning': 'Only published versions can restore it.',
    'conflict.confirmOverwriteAction': 'Yes, overwrite it',
    'conflict.back': 'Back',
    'conflict.copied': 'Copied',
    'conflict.copyFailed': 'Could not copy',
    'conflict.fetchLatestFailed': 'Could not fetch the latest draft',
    'leave.title': 'Leave without saving?',
    'leave.body': 'You have unsaved changes.',
    'leave.stayAction': 'Stay in the editor',
    'leave.leaveAction': 'Leave',
    'recovery.title': 'Restore unsaved local changes?',
    'recovery.body': 'We found local changes that were not saved to the server.',
    'recovery.savedAt': 'Kept locally: {when}',
    'recovery.restore': 'Restore my changes',
    'recovery.discard': 'Discard them',
    'readOnly.notice': 'Read-only: you do not have permission to edit the draft.',
    'readOnly.saveForbidden': 'No permission to save',
    'saveFailure.network': 'Could not save (offline). Your changes are kept on this device.',
    'saveFailure.other': 'Could not save. Your changes are kept on this device.',
    'saveFailure.retry': 'Try saving again',
    'builderMode.design': 'Design',
    'builderMode.preview': 'App Preview',
    'preview.browserTruthBadge': 'Browser Preview — not a real runtime render',
    'preview.fullPreviewAction': 'Full Preview',
    'preview.exitFullPreviewAction': 'Exit Full Preview',
    'preview.limitation.navigateUnsupportedTitle': 'Not supported by the real app',
    'preview.limitation.navigateUnsupportedDescription': 'The shipped app doesn\'t wire up navigation to "{pageId}" today — only Home and Cart are',
    'preview.limitation.requiresLiveDataTitle': 'Unavailable in Browser Preview — requires live data',
    'preview.inlineTitle': 'Mobile preview',
    'preview.refreshAction': 'Refresh Preview',
    'preview.refreshing': 'Refreshing…',
    'preview.refreshSuccessTitle': 'Preview refreshed',
    'preview.refreshErrorTitle': 'Could not refresh the preview',
    'preview.showInlineAction': 'Show mobile preview',
    'preview.hideInlineAction': 'Hide mobile preview',
    // APP-BUILDER-PREVIEW-UX-1 — `PreviewOnPhoneButton` reads `appBuilder.detail.previewSessions.*`
    // (a different namespace than this file's own `appBuilder.builder.*`), so this translator's
    // `appBuilder.builder.` prefix strip never matches it; the full dotted key is the only one
    // that resolves. See `preview-on-phone.tsx` and MOBILE-PREVIEW-7's own detail-page test file
    // for the identical real copy these English strings mirror.
    'appBuilder.detail.previewSessions.qrAction': 'Preview on Phone',
    'appBuilder.detail.previewSessions.qrDialogTitle': 'Preview on your phone',
    'appBuilder.detail.previewSessions.qrCreating': 'Preparing a one-time code…',
    'appBuilder.detail.previewSessions.qrInstructions': 'Scan this code on the device.',
    'appBuilder.detail.previewSessions.qrExpiresIn': 'Expires in {seconds}s',
    'appBuilder.detail.previewSessions.qrExpired': 'This code has expired. Generate a new one.',
    'appBuilder.detail.previewSessions.qrConsumed': 'Connected — a preview session is now active on the device.',
    'appBuilder.detail.previewSessions.qrCopyLink': 'Copy link',
    'appBuilder.detail.previewSessions.qrCopied': 'Copied',
    'appBuilder.detail.previewSessions.qrRegenerate': 'Generate a new code',
    'appBuilder.detail.previewSessions.qrRetry': 'Try again',
    'appBuilder.detail.previewSessions.qrErrorTitle': 'Could not prepare the preview code',
    'appBuilder.detail.previewSessions.qrErrorBody': 'Something went wrong while preparing the preview code.',
    'appBuilder.detail.previewSessions.qrTemporaryNote': 'This code is temporary and works once.',
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
const { toastFns } = vi.hoisted(() => ({ toastFns: { success: vi.fn(), error: vi.fn(), toast: vi.fn() } }));
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

// APP-BUILDER-PREVIEW-UX-1 — jsdom doesn't implement `matchMedia` by default; the page uses
// it (same pattern already shipped in `components/layout/sidebar.tsx`) to decide whether the
// inline mobile-preview pane mounts at all, specifically so a narrow/non-CSS environment like
// this one never duplicates canvas content into the DOM. `wideBuilderViewport` defaults to
// `false` so every pre-existing test below (none of which know about the inline pane) keeps
// seeing exactly one canvas, exactly as before; the dedicated inline-preview tests flip it to
// `true` before rendering.
let wideBuilderViewport = false;
// `window` يُشارَك بين ملفات الاختبار (singleFork في vitest.config)؛ نُعيد matchMedia الأصلي بعد الملف حتى لا يرى
// الملف التالي (FacetVisualEditor) مجسّماً بـ matches=false يحوّله إلى تخطيط الجوال.
const originalMatchMedia = window.matchMedia;
afterAll(() => {
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  wideBuilderViewport = false;
  window.matchMedia = ((query: string) => ({
    matches: wideBuilderViewport,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
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
    toastFns.toast.mockReset();
    currentUser.mockReturnValue({ role: 'owner' });
    window.localStorage.clear();
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

  // MOBILE-PREVIEW-3 — Browser App Preview shell. `builderMode` ('design' | 'preview') is
  // fully independent of `PreviewState` ('draft' | 'published' | 'default') tested above —
  // these tests only exercise the new top-level switch and its own shell.
  describe('App Preview shell', () => {
    it('switching to App Preview hides every editing control and structure/inspector pane, shows the browser-preview truth badge, and still renders the live draft content read-only', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));

      // No editing affordances survive the mode switch — not merely disabled, entirely absent.
      expect(screen.queryAllByText('Save').length).toBe(0);
      expect(screen.queryAllByText('Publish').length).toBe(0);
      expect(screen.queryAllByLabelText('Undo').length).toBe(0);
      expect(screen.queryAllByLabelText('Redo').length).toBe(0);
      expect(screen.queryAllByText('Add page').length).toBe(0);
      expect(screen.queryAllByText('Layers').length).toBe(0);
      // The type-tag chrome ('Section'/'Text'/'Product Card') is authoring-only — gone too.
      expect(screen.queryAllByText('Section').length).toBe(0);

      // Honesty label + the live draft's own content, still visible inside the device frame.
      expect(screen.getByText('Browser Preview — not a real runtime render')).toBeTruthy();
      expect(screen.getAllByText('Featured').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Welcome').length).toBeGreaterThan(0);
    });

    it('a click on canvas content in App Preview never selects anything (no Inspector, no stray mutation)', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      await userEvent.setup().click(screen.getByText('Welcome'));

      // Nothing resembling the Inspector (props/action panel) is even mounted in Preview mode.
      expect(screen.queryAllByText('Properties').length).toBe(0);
      expect(screen.queryAllByText('This component has no properties.').length).toBe(0);
    });

    it('App Preview offers iPhone/Android device-frame presets, defaulting to iPhone, and switches the rendered frame', async () => {
      mockApi();
      const { container } = render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));

      expect(container.querySelector('[data-device-frame="iphone"]')).toBeTruthy();

      await userEvent.setup().click(screen.getByRole('button', { name: 'Android' }));
      expect(container.querySelector('[data-device-frame="android"]')).toBeTruthy();
      expect(container.querySelector('[data-device-frame="iphone"]')).toBeNull();
    });

    it('Full Preview opens a distraction-free overlay that still shows the truth badge and device content, and Exit returns to the normal Preview toolbar', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      await userEvent.setup().click(screen.getByRole('button', { name: 'Full Preview' }));

      expect(screen.getByText('Browser Preview — not a real runtime render')).toBeTruthy();
      expect(screen.getAllByText('Featured').length).toBeGreaterThan(0);
      const exitButton = screen.getByRole('button', { name: 'Exit Full Preview' });
      expect(exitButton).toBeTruthy();
      // The device-preset toolbar is not part of the Full Preview chrome.
      expect(screen.queryAllByText('Android').length).toBe(0);

      await userEvent.setup().click(exitButton);

      expect(screen.queryAllByText('Exit Full Preview').length).toBe(0);
      expect(screen.getByRole('button', { name: 'Android' })).toBeTruthy();
    });

    it('App Preview follows the Draft/Published/Default source switcher exactly like Design mode, staying read-only for every source', async () => {
      api.mockImplementation((path?: string) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
        if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
        if (path.endsWith('/apps/app-1')) return Promise.resolve({ data: appData });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      expect(screen.getAllByText('Featured').length).toBeGreaterThan(0);

      await userEvent.setup().click(screen.getByRole('button', { name: 'Default' }));

      expect(await screen.findByText('أَوْج')).toBeTruthy();
      expect(screen.getByText('Default experience — what a customer sees before this tenant has published anything')).toBeTruthy();
      expect(screen.queryAllByText('Featured').length).toBe(0);
      // Still no editing chrome for the Default source either.
      expect(screen.queryAllByText('Save').length).toBe(0);
    });

    it('returning to Design from App Preview restores the exact same editor state — selection and unsaved changes are never reset by the mode switch', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      const desktopTree = screen.getAllByRole('tree')[0];
      await userEvent.setup().click(within(desktopTree).getByText('Text'));
      const textareas = await screen.findAllByDisplayValue('Welcome');
      fireEvent.change(textareas[0], { target: { value: 'Bye' } });
      expect(screen.getByText('Unsaved changes')).toBeTruthy();

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      expect(screen.getAllByText('Bye').length).toBeGreaterThan(0);

      await userEvent.setup().click(screen.getByRole('button', { name: 'Design' }));

      // The Text node is still selected, still shows its edited value, and the draft is
      // still marked dirty — none of this was cleared by switching modes in either direction.
      expect(screen.getByText('Unsaved changes')).toBeTruthy();
      expect(screen.getAllByDisplayValue('Bye').length).toBeGreaterThan(0);
    });

    it('the locale toggle still applies RTL/LTR direction to the App Preview canvas content', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      const screenBoxAr = screen.getAllByText('Featured')[0].closest('[dir]');
      expect(screenBoxAr?.getAttribute('dir')).toBe('rtl');

      await userEvent.setup().click(screen.getByRole('button', { name: 'EN' }));
      const screenBoxEn = screen.getAllByText('Featured')[0].closest('[dir]');
      expect(screenBoxEn?.getAttribute('dir')).toBe('ltr');
    });
  });

  // MOBILE-PREVIEW-4 — runtime semantic parity. Preview now actually dispatches a tapped
  // node's `action` (previously a complete no-op — see action-semantics.ts's own doc comments),
  // honestly matching what the shipped runtime's RuntimeActionHandler would do: only 'home'/
  // 'cart' are real, wired navigation targets; anything else, and every action that needs live
  // commerce data, must show a truthful notice — never fake success, never invent a generic
  // page router the real app doesn't have.
  describe('MOBILE-PREVIEW-4 runtime semantic parity', () => {
    const navDraftData = {
      id: 'draft-1', builder_app_id: 'app-1', revision: 0, updated_at: null,
      schema: {
        schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0',
        navigation: { initialPageId: 'home' },
        theme: { tokens: {} },
        pages: {
          home: {
            type: 'Page', id: 'home-root',
            children: [
              { type: 'Text', id: 'home-text', props: { text: 'Home content' } },
              {
                type: 'Button', id: 'btn-cart', props: { label: 'Go to cart' },
                action: { type: 'navigate', params: { pageId: 'cart' } },
              },
              {
                type: 'Button', id: 'btn-about', props: { label: 'Go to about' },
                action: { type: 'navigate', params: { pageId: 'about' } },
              },
            ],
          },
          cart: {
            type: 'Page', id: 'cart-root',
            children: [{ type: 'Text', id: 'cart-text', props: { text: 'Cart content' } }],
          },
          about: {
            type: 'Page', id: 'about-root',
            children: [{ type: 'Text', id: 'about-text', props: { text: 'About content' } }],
          },
        },
      },
    };

    function mockNavApi() {
      api.mockImplementation((path?: string) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/draft')) return Promise.resolve({ data: navDraftData });
        if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
        if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });
    }

    it('tapping a navigate action to a runtime-wired pageId (home/cart) actually switches the visible page', async () => {
      mockNavApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Home content');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      await userEvent.setup().click(screen.getByText('Go to cart'));

      expect(await screen.findByText('Cart content')).toBeTruthy();
      expect(screen.queryByText('Home content')).toBeNull();
      expect(toastFns.toast).not.toHaveBeenCalled();
    });

    it('tapping a navigate action to a pageId the shipped runtime never wires up shows a truthful limitation notice and does not switch pages, even though that page exists in the schema', async () => {
      mockNavApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Home content');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      await userEvent.setup().click(screen.getByText('Go to about'));

      expect(toastFns.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Not supported by the real app',
          description: 'The shipped app doesn\'t wire up navigation to "about" today — only Home and Cart are',
          variant: 'warning',
        })
      );
      expect(screen.getAllByText('Home content').length).toBeGreaterThan(0);
      expect(screen.queryByText('About content')).toBeNull();
    });

    it('tapping an action that needs live commerce data (openProduct) shows a truthful "unavailable" notice, never a fake success', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      await userEvent.setup().click(screen.getByRole('button', { name: 'App Preview' }));
      await userEvent.setup().click(screen.getByText('Shoe'));

      expect(toastFns.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Unavailable in Browser Preview — requires live data', variant: 'warning' })
      );
    });

    it('Design mode is unaffected: tapping the same navigate-actionable node only selects it, never dispatches or shows a notice', async () => {
      mockNavApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Home content');

      await userEvent.setup().click(screen.getByText('Go to cart'));

      expect(screen.getByText('Home content')).toBeTruthy();
      expect(screen.queryByText('Cart content')).toBeNull();
      expect(toastFns.toast).not.toHaveBeenCalled();
    });
  });

  // APP-BUILDER-PREVIEW-UX-1 — the approved UX decision's required side-by-side builder
  // layout (§2), interactive navigation inside it (§3), and the two separate preview toolbar
  // actions (§4). `wideBuilderViewport` is flipped to `true` only in this block; every test
  // above runs at the default `false` and already proved (41/41 green before this block
  // existed) that nothing here changes narrow-viewport behavior.
  describe('APP-BUILDER-PREVIEW-UX-1 — inline mobile preview + Refresh Preview', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const navDraftData = {
      id: 'draft-1', builder_app_id: 'app-1', revision: 0, updated_at: null,
      schema: {
        schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0',
        navigation: { initialPageId: 'home' },
        theme: { tokens: {} },
        pages: {
          home: {
            type: 'Page', id: 'home-root',
            children: [
              { type: 'Text', id: 'home-text', props: { text: 'Home content' } },
              {
                type: 'Button', id: 'btn-cart', props: { label: 'Go to cart' },
                action: { type: 'navigate', params: { pageId: 'cart' } },
              },
              {
                type: 'Button', id: 'btn-about', props: { label: 'Go to about' },
                action: { type: 'navigate', params: { pageId: 'about' } },
              },
            ],
          },
          cart: {
            type: 'Page', id: 'cart-root',
            children: [{ type: 'Text', id: 'cart-text', props: { text: 'Cart content' } }],
          },
          about: {
            type: 'Page', id: 'about-root',
            children: [{ type: 'Text', id: 'about-text', props: { text: 'About content' } }],
          },
        },
      },
    };

    function mockNavApi() {
      api.mockImplementation((path?: string) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/draft')) return Promise.resolve({ data: navDraftData });
        if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
        if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });
    }

    it('on a narrow/default viewport, Design mode never mounts the inline mobile preview (no duplicate canvas content, no layout regression)', async () => {
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findByText('Featured');

      expect(screen.queryByTestId('inline-mobile-preview')).toBeNull();
      // Exactly one canvas worth of content — the editable one — confirming nothing here
      // silently duplicates page text the way an always-mounted pane would.
      expect(screen.getAllByText('Featured').length).toBe(1);
    });

    it('on a wide viewport, Design mode shows the inline mobile preview side-by-side with the editable canvas, each with Refresh Preview and Preview on Phone as two separate actions', async () => {
      wideBuilderViewport = true;
      mockApi();
      render(<AppBuilderWorkspacePage />);
      // The live draft content renders a second time, inside the inline frame.
      await waitFor(() => expect(screen.getAllByText('Featured').length).toBe(2));

      const inlinePane = screen.getByTestId('inline-mobile-preview');

      const refreshButton = within(inlinePane).getByRole('button', { name: 'Refresh Preview' });
      const phoneButton = within(inlinePane).getByRole('button', { name: 'Preview on Phone' });
      expect(refreshButton).toBeTruthy();
      expect(phoneButton).toBeTruthy();
      expect(refreshButton).not.toBe(phoneButton);
    });

    it('"Preview on Phone" opens the existing MOBILE-PREVIEW-7 QR dialog and never triggers a Refresh Preview network call', async () => {
      wideBuilderViewport = true;
      api.mockImplementation((path?: string, init?: { method?: string }) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
        if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: [] });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.resolve({
            reference: 'builder-toolbar-reference',
            deep_link: 'https://preview.example/preview/builder-toolbar-reference',
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            exchange_reference_id: 'xref-builder-1',
          });
        }
        if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });
      render(<AppBuilderWorkspacePage />);
      await waitFor(() => expect(screen.getAllByText('Featured').length).toBe(2));

      const registriesCallsBefore = api.mock.calls.filter((call) => (call[0] as string).endsWith('/registries')).length;
      const inlinePane = screen.getByTestId('inline-mobile-preview');
      await userEvent.setup().click(within(inlinePane).getByRole('button', { name: 'Preview on Phone' }));

      expect(await screen.findByText('Scan this code on the device.')).toBeTruthy();
      const exchangeCall = api.mock.calls.find(
        (call) => call[0] === '/app-builder/apps/app-1/preview-exchange-references' && call[1]?.method === 'POST'
      );
      expect(exchangeCall).toBeTruthy();
      // Opening the QR dialog never re-fetches the registries the way Refresh Preview does.
      const registriesCallsAfter = api.mock.calls.filter((call) => (call[0] as string).endsWith('/registries')).length;
      expect(registriesCallsAfter).toBe(registriesCallsBefore);
    });

    it('"Preview on Phone" in the builder reaches the "Connected" state on its own, with no `onConsumed` callback wired (it has no session list to refresh)', async () => {
      // PR #1137 review fix: `onConsumed` is optional on `PreviewOnPhoneButton` and the
      // builder page passes none — this proves the QR dialog's own poll/consumption flow
      // stays fully self-contained here and never depends on that prop existing.
      wideBuilderViewport = true;
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let sessionExists = false;
      api.mockImplementation((path?: string, init?: { method?: string }) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
        if (path.endsWith('/registries')) return Promise.resolve({ data: registriesData });
        if (path.endsWith('/preview-exchange-references') && init?.method === 'POST') {
          return Promise.resolve({
            reference: 'builder-consumed-reference',
            deep_link: 'https://preview.example/preview/builder-consumed-reference',
            expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            exchange_reference_id: 'xref-builder-consumed',
          });
        }
        if (path.endsWith('/preview-sessions')) return Promise.resolve({ data: sessionExists ? [{ id: 'ps-1' }] : [] });
        if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<AppBuilderWorkspacePage />);
      await waitFor(() => expect(screen.getAllByText('Featured').length).toBe(2));

      const inlinePane = screen.getByTestId('inline-mobile-preview');
      await user.click(within(inlinePane).getByRole('button', { name: 'Preview on Phone' }));
      await screen.findByText(/Expires in \d+s/);

      sessionExists = true;
      await vi.advanceTimersByTimeAsync(4500);

      expect(await screen.findByText('Connected — a preview session is now active on the device.')).toBeTruthy();
    });

    it('Refresh Preview shows a loading state, gives success feedback, and never calls a mutating (draft PUT / publish POST) endpoint', async () => {
      wideBuilderViewport = true;
      let resolveSecondRegistriesCall: (() => void) | null = null;
      let registriesCallCount = 0;
      api.mockImplementation((path?: string) => {
        if (!path) return Promise.resolve({ data: null });
        if (path.endsWith('/registries')) {
          registriesCallCount += 1;
          if (registriesCallCount === 1) return Promise.resolve({ data: registriesData });
          return new Promise((resolve) => {
            resolveSecondRegistriesCall = () => resolve({ data: registriesData });
          });
        }
        if (path.endsWith('/draft')) return Promise.resolve({ data: draftData });
        if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
        return Promise.reject(new Error(`unexpected path: ${path}`));
      });

      render(<AppBuilderWorkspacePage />);
      await waitFor(() => expect(screen.getAllByText('Featured').length).toBe(2));

      const inlinePane = screen.getByTestId('inline-mobile-preview');
      await userEvent.setup().click(within(inlinePane).getByRole('button', { name: 'Refresh Preview' }));

      expect(await within(inlinePane).findByRole('button', { name: 'Refreshing…' })).toBeTruthy();
      expect((within(inlinePane).getByRole('button', { name: 'Refreshing…' }) as HTMLButtonElement).disabled).toBe(true);

      resolveSecondRegistriesCall!();

      expect(await within(inlinePane).findByRole('button', { name: 'Refresh Preview' })).toBeTruthy();
      expect(toastFns.success).toHaveBeenCalledWith('Preview refreshed');

      const mutatingCall = api.mock.calls.find(
        (call) => (call[1] as { method?: string } | undefined)?.method === 'PUT' || (call[1] as { method?: string } | undefined)?.method === 'POST'
      );
      expect(mutatingCall).toBeUndefined();
    });

    it('a runtime-wired navigate action tapped inside the inline preview navigates only that frame — the editable canvas and its selection stay on the page being edited', async () => {
      wideBuilderViewport = true;
      mockNavApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findAllByText('Home content');

      const inlinePane = screen.getByTestId('inline-mobile-preview');
      await userEvent.setup().click(within(inlinePane).getByText('Go to cart'));

      expect(await within(inlinePane).findByText('Cart content')).toBeTruthy();
      expect(within(inlinePane).queryByText('Home content')).toBeNull();
      // The editable canvas (outside the inline pane) is untouched — still editing Home.
      expect(screen.getByText('Home content')).toBeTruthy();
      expect(toastFns.toast).not.toHaveBeenCalled();
    });

    it('a navigate target the shipped runtime never wires up shows the same truthful limitation notice inside the inline preview, without switching any page', async () => {
      wideBuilderViewport = true;
      mockNavApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findAllByText('Home content');

      const inlinePane = screen.getByTestId('inline-mobile-preview');
      await userEvent.setup().click(within(inlinePane).getByText('Go to about'));

      expect(toastFns.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Not supported by the real app',
          description: 'The shipped app doesn\'t wire up navigation to "about" today — only Home and Cart are',
          variant: 'warning',
        })
      );
      expect(within(inlinePane).queryByText('About content')).toBeNull();
      // Neither the inline frame nor the editable canvas navigated away from Home.
      expect(screen.getAllByText('Home content').length).toBe(2);
    });

    it('an action requiring live commerce data tapped inside the inline preview shows a truthful "unavailable" notice, never a fake success', async () => {
      wideBuilderViewport = true;
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await waitFor(() => expect(screen.getAllByText('Featured').length).toBe(2));

      const inlinePane = screen.getByTestId('inline-mobile-preview');
      await userEvent.setup().click(within(inlinePane).getByText('Shoe'));

      expect(toastFns.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Unavailable in Browser Preview — requires live data', variant: 'warning' })
      );
    });

    it('selecting a different page to edit re-syncs the inline preview to follow it, and the inline frame still respects the RTL/LTR locale toggle', async () => {
      wideBuilderViewport = true;
      mockNavApi();
      render(<AppBuilderWorkspacePage />);
      await screen.findAllByText('Home content');

      const inlinePane = screen.getByTestId('inline-mobile-preview');
      // Page-list rows render twice (desktop aside + mobile bottom-sheet copy, same pattern
      // other tests in this file already rely on) — the desktop copy is first in DOM order.
      const [desktopCartPageRow] = screen.getAllByText('cart');
      await userEvent.setup().click(desktopCartPageRow);

      expect(await within(inlinePane).findByText('Cart content')).toBeTruthy();

      const screenBoxAr = within(inlinePane).getByText('Cart content').closest('[dir]');
      expect(screenBoxAr?.getAttribute('dir')).toBe('rtl');

      await userEvent.setup().click(screen.getByRole('button', { name: 'EN' }));
      const screenBoxEn = within(inlinePane).getByText('Cart content').closest('[dir]');
      expect(screenBoxEn?.getAttribute('dir')).toBe('ltr');
    });

    it('collapsing the inline preview hides its canvas and both toolbar actions behind a single "show" toggle, and re-opening restores them', async () => {
      wideBuilderViewport = true;
      mockApi();
      render(<AppBuilderWorkspacePage />);
      await waitFor(() => expect(screen.getAllByText('Featured').length).toBe(2));

      await userEvent.setup().click(screen.getByRole('button', { name: 'Hide mobile preview' }));

      expect(screen.queryByTestId('inline-mobile-preview')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Preview on Phone' })).toBeNull();
      // Exactly one copy of the page content remains — the editable canvas.
      expect(screen.getAllByText('Featured').length).toBe(1);

      await userEvent.setup().click(screen.getByRole('button', { name: 'Show mobile preview' }));

      expect(screen.getByTestId('inline-mobile-preview')).toBeTruthy();
      expect(screen.getAllByText('Featured').length).toBe(2);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════
//  AD-01 / S01b — سلامة الحفظ: قفل تفاؤلي، تعارض، نسخة محلية، حارس مغادرة، صلاحيات
// ═══════════════════════════════════════════════════════════════════════════
describe('AppBuilderWorkspacePage — save safety (AD-01 / S01b)', () => {
  const DRAFT_PATH = '/app-builder/apps/app-1/draft';
  const BACKUP_KEY = 'awj.appBuilder.draftBackup.v1.u1.app-1';
  const conflictBody = { message: 'conflict', reason: 'draft_conflict', current_revision: 5, base_revision: 0, updated_by: 'u2', updated_at: '2026-10-30T10:00:00+00:00' };

  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    toastFns.success.mockReset();
    toastFns.error.mockReset();
    toastFns.toast.mockReset();
    currentUser.mockReturnValue({ id: 'u1', role: 'owner' });
    window.localStorage.clear();
  });

  const putCalls = () => api.mock.calls.filter((c) => c[0] === DRAFT_PATH && c[1]?.method === 'PUT');
  const getDraftCalls = () => api.mock.calls.filter((c) => c[0] === DRAFT_PATH && !c[1]?.method);
  type Override = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown> | undefined;
  function overrideApi(custom: Override) {
    const base = api.getMockImplementation()!;
    api.mockImplementation((path?: string, init?: { method?: string; body?: unknown }) => custom(path ?? '', init) ?? base(path, init));
  }

  async function openEditor() {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
  }

  async function makeEdit(value = 'Bye') {
    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));
    const textareas = await screen.findAllByDisplayValue('Welcome');
    fireEvent.change(textareas[0], { target: { value } });
  }

  async function clickSave() {
    await userEvent.setup().click(screen.getAllByText('Save')[0]);
  }

  async function conflictDialog() {
    return within(await screen.findByRole('dialog', { name: 'Draft save conflict' }));
  }

  it('sends the loaded revision as base_revision and rebases on the revision the server returns', async () => {
    const { ApiError: _unused } = await import('@/lib/api');
    void _unused;
    mockApi();
    let nextRevision = 1;
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT' ? Promise.resolve({ data: { ...draftData, revision: nextRevision++ } }) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    await makeEdit('Bye');
    await clickSave();
    await waitFor(() => expect(putCalls().length).toBe(1));
    expect((putCalls()[0][1].body as { base_revision: number }).base_revision).toBe(0);

    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));
    const [textarea] = await screen.findAllByDisplayValue('Bye');
    fireEvent.change(textarea, { target: { value: 'Bye again' } });
    await clickSave();
    await waitFor(() => expect(putCalls().length).toBe(2));
    expect((putCalls()[1][1].body as { base_revision: number }).base_revision).toBe(1);
  });

  it('a 409 draft_conflict opens the conflict dialog, keeps the edits unsaved, and keeps a local backup', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi();
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT' ? Promise.reject(new ApiError(409, 'conflict', conflictBody)) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    await makeEdit('Bye');
    await clickSave();

    const dialog = await conflictDialog();
    expect(dialog.getByText('Saved elsewhere (version 5) after you opened version 0.')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.queryAllByText('Saved')).toHaveLength(0);
    expect(toastFns.success).not.toHaveBeenCalled();

    const backup = JSON.parse(window.localStorage.getItem(BACKUP_KEY)!);
    expect(backup.baseRevision).toBe(0);
    expect(JSON.stringify(backup.schema)).toContain('Bye');
  });

  it('"Keep editing" closes the conflict dialog without losing anything', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi();
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT' ? Promise.reject(new ApiError(409, 'conflict', conflictBody)) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();

    await userEvent.setup().click((await conflictDialog()).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Draft save conflict' })).toBeNull());
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getAllByDisplayValue('Bye').length).toBeGreaterThan(0);
  });

  it('overwrite never sends before re-fetching the latest revision and an explicit confirmation', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi();
    let putNo = 0;
    overrideApi((path, init) => {
      if (path === DRAFT_PATH && init?.method === 'PUT') {
        putNo++;
        return putNo === 1 ? Promise.reject(new ApiError(409, 'conflict', conflictBody)) : Promise.resolve({ data: { ...draftData, revision: 6 } });
      }
      if (path === DRAFT_PATH && !init?.method) return Promise.resolve({ data: { ...draftData, revision: 5, updated_at: '2026-10-30T10:00:00+00:00' } });
      return undefined;
    });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();

    const user = userEvent.setup();
    const initialGets = getDraftCalls().length;
    await user.click((await conflictDialog()).getByRole('button', { name: 'Overwrite the saved draft' }));

    // الخطوة 1: إعادة الجلب فقط — لا PUT ثانٍ بعد، ويُطلب التأكيد.
    const confirm = await conflictDialog();
    expect(await confirm.findByText('Replace saved version 5 with my changes.')).toBeTruthy();
    expect(getDraftCalls().length).toBe(initialGets + 1);
    expect(putCalls().length).toBe(1);

    // الخطوة 2: بعد التأكيد فقط يُرسَل الحفظ، بأساس الـrevision الأحدث (5) لا القديم (0).
    await user.click(confirm.getByRole('button', { name: 'Yes, overwrite it' }));
    await waitFor(() => expect(putCalls().length).toBe(2));
    expect((putCalls()[1][1].body as { base_revision: number }).base_revision).toBe(5);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Draft save conflict' })).toBeNull());
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it('if the draft moves again during an overwrite, the dialog returns to the choice with a notice and nothing is written', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi();
    overrideApi((path, init) => {
      if (path === DRAFT_PATH && init?.method === 'PUT') {
        const second = putCalls().length >= 1;
        return Promise.reject(new ApiError(409, 'conflict', second ? { ...conflictBody, current_revision: 9, base_revision: 5 } : conflictBody));
      }
      if (path === DRAFT_PATH && !init?.method) return Promise.resolve({ data: { ...draftData, revision: 5, updated_at: null } });
      return undefined;
    });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();

    const user = userEvent.setup();
    await user.click((await conflictDialog()).getByRole('button', { name: 'Overwrite the saved draft' }));
    await user.click((await conflictDialog()).getByRole('button', { name: 'Yes, overwrite it' }));

    const dialog = await conflictDialog();
    expect(await dialog.findByText('The draft changed again.')).toBeTruthy();
    expect(dialog.getByText('Saved elsewhere (version 9) after you opened version 5.')).toBeTruthy();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(BACKUP_KEY)!).schema)).toContain('Bye');
  });

  it('"Load the saved draft" needs a second confirmation, then reloads the server draft and drops the local backup', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi();
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT' ? Promise.reject(new ApiError(409, 'conflict', conflictBody)) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();

    const user = userEvent.setup();
    const loadsBefore = getDraftCalls().length;
    await user.click((await conflictDialog()).getByRole('button', { name: 'Load the saved draft' }));
    expect(getDraftCalls().length).toBe(loadsBefore); // ما زال يسأل
    await user.click((await conflictDialog()).getByRole('button', { name: 'Load and discard my changes' }));

    await waitFor(() => expect(getDraftCalls().length).toBe(loadsBefore + 1));
    await screen.findByText('Featured');
    expect(screen.queryAllByText('Unsaved changes')).toHaveLength(0);
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(putCalls().length).toBe(1); // لا حفظ إضافي
  });

  it('"Copy my changes" puts the current schema on the clipboard', async () => {
    const { ApiError } = await import('@/lib/api');
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockApi();
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT' ? Promise.reject(new ApiError(409, 'conflict', conflictBody)) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();

    // userEvent.setup() يركّب مجسّم clipboard خاصاً به؛ نضع مجسّمنا بعده مباشرةً.
    const user = userEvent.setup();
    // الإعداد يُلغى في finally: `navigator` يُشارَك بين الملفات في singleFork، وتسريب clipboard يكسر اختبارات لاحقة.
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      await user.click((await conflictDialog()).getByRole('button', { name: 'Copy my changes' }));
      await waitFor(() => expect(writeText).toHaveBeenCalled());
      expect(String(writeText.mock.calls[0][0])).toContain('Bye');
      expect(toastFns.success).toHaveBeenCalledWith('Copied');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
  });

  it('a network failure keeps the edits unsaved and backed up, shows a persistent retry banner, and a retry succeeds', async () => {
    mockApi();
    let fail = true;
    overrideApi((path, init) => {
      if (path === DRAFT_PATH && init?.method === 'PUT') {
        return fail ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data: { ...draftData, revision: 1 } });
      }
      return undefined;
    });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();

    expect(await screen.findByText('Could not save (offline). Your changes are kept on this device.')).toBeTruthy();
    expect(toastFns.error).toHaveBeenCalledWith('Could not save the draft', 'Server unreachable');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(BACKUP_KEY)!).schema)).toContain('Bye');

    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try saving again' }));
    await waitFor(() => expect(screen.queryByText('Could not save (offline). Your changes are kept on this device.')).toBeNull());
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it('edits made while a save is in flight are not reported as saved', async () => {
    mockApi();
    let resolvePut: () => void = () => undefined;
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT'
      ? new Promise((resolve) => { resolvePut = () => resolve({ data: { ...draftData, revision: 1 } }); })
      : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();
    await waitFor(() => expect(putCalls().length).toBe(1));

    const [textarea] = screen.getAllByDisplayValue('Bye');
    fireEvent.change(textarea, { target: { value: 'Bye (typed during the save)' } });
    resolvePut();

    await waitFor(() => expect(toastFns.success).toHaveBeenCalled());
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // النسخة المحلية مؤجَّلة (400ms) — يُنتظر وصولها ثم يُتحقق من أنها تحمل الكتابة أثناء الحفظ.
    await waitFor(() => expect(window.localStorage.getItem(BACKUP_KEY)).not.toBeNull());
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(BACKUP_KEY)!).schema)).toContain('typed during the save');
  });

  it('when a slow save fails, the local backup keeps the newest edits, not the older request snapshot', async () => {
    mockApi();
    let rejectPut: (e: unknown) => void = () => undefined;
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT'
      ? new Promise((_resolve, reject) => { rejectPut = reject; })
      : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();
    await waitFor(() => expect(putCalls().length).toBe(1));

    const [textarea] = screen.getAllByDisplayValue('Bye');
    fireEvent.change(textarea, { target: { value: 'Bye (newest)' } });
    rejectPut(new TypeError('Failed to fetch'));

    expect(await screen.findByText('Could not save (offline). Your changes are kept on this device.')).toBeTruthy();
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(BACKUP_KEY)!).schema)).toContain('Bye (newest)');
  });

  it('confirming the leave dialog flushes the newest edits to the local backup immediately (no 400ms debounce wait)', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye (just typed)');
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull(); // الـdebounce لم ينتهِ بعد

    // رابط داخلي يفتح حوار المغادرة، ثم «مغادرة» تكتب النسخة فوراً.
    const link = document.createElement('a');
    link.href = '/commerce';
    document.body.appendChild(link);
    fireEvent.click(link);
    const leave = within(await screen.findByRole('dialog', { name: 'Leave without saving?' }));
    await userEvent.setup().click(leave.getByRole('button', { name: 'Leave' }));
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(BACKUP_KEY)!).schema)).toContain('Bye (just typed)');
    link.remove();
  });

  it('restoring a backup that deleted the server draft\'s selected page re-selects a valid page from the restored schema', async () => {
    const edited = JSON.parse(JSON.stringify(draftData.schema));
    const homeId = edited.navigation.initialPageId;
    edited.pages.second = { ...JSON.parse(JSON.stringify(edited.pages[homeId])), id: 'second-root', children: [{ type: 'Text', id: 'second-text', props: { text: 'Second page text' } }] };
    delete edited.pages[homeId];
    edited.navigation.initialPageId = 'second';
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema: edited, baseRevision: 0, savedAt: '2026-10-30T09:00:00+00:00' }));
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    const recovery = within(await screen.findByRole('dialog', { name: 'Restore unsaved local changes?' }));
    await userEvent.setup().click(recovery.getByRole('button', { name: 'Restore my changes' }));
    expect((await screen.findAllByText('Second page text')).length).toBeGreaterThan(0);
  });

  it("a successful save does not erase another tab's different unsaved backup", async () => {
    mockApi();
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT' ? Promise.resolve({ data: { ...draftData, revision: 1 } }) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');
    await makeEdit('Bye');
    await clickSave();
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));

    // تبويب آخر كتب نسخته المحلية أثناء الحفظ (محتوى مختلف عمّا حُفظ هنا).
    const foreign = JSON.parse(JSON.stringify(draftData.schema));
    foreign.pages.home.children[0].children[0].props.text = 'Other tab edits';
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema: foreign, baseRevision: 0, savedAt: 'x' }));
    const [textarea] = screen.getAllByDisplayValue('Bye');
    fireEvent.change(textarea, { target: { value: 'Bye again' } });
    await clickSave();
    await waitFor(() => expect(putCalls().length).toBe(2));
    await waitFor(() => expect(toastFns.success).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(JSON.parse(window.localStorage.getItem(BACKUP_KEY)!).schema)).toContain('Other tab edits');
  });

  const versionPosts = () => api.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].endsWith('/versions') && c[1]?.method === 'POST');
  async function openPublishDialog() {
    await userEvent.setup().click(screen.getAllByText('Publish')[0]);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ready to publish.');
    return dialog;
  }

  it('publishing sends the revision of the draft the user is looking at as expected_draft_revision', async () => {
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const dialog = await openPublishDialog();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(versionPosts().length).toBe(1));
    expect((versionPosts()[0][1].body as { expected_draft_revision: number }).expected_draft_revision).toBe(0);
  });

  it('a 409 draft_changed_since_review closes the dialog, explains that nothing was published, and offers no success', async () => {
    const { ApiError } = await import('@/lib/api');
    mockApi({ publishError: new ApiError(409, 'changed', { reason: 'draft_changed_since_review', current_revision: 4, expected_revision: 0 }) });
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const dialog = await openPublishDialog();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(toastFns.error).toHaveBeenCalledWith('The draft changed', 'Nothing was published. Reload and review.'));
    expect(toastFns.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a local backup that differs from the server draft is offered for restore, and restoring keeps its original base revision', async () => {
    const edited = JSON.parse(JSON.stringify(draftData.schema));
    edited.pages.home.children[0].children[0].props.text = 'Recovered text';
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema: edited, baseRevision: 0, savedAt: '2026-10-30T09:00:00+00:00' }));
    const { ApiError } = await import('@/lib/api');
    mockApi();
    overrideApi((path, init) => (path === DRAFT_PATH && init?.method === 'PUT'
      ? Promise.reject(new ApiError(409, 'conflict', { ...conflictBody, current_revision: 3 }))
      : path === DRAFT_PATH && !init?.method ? Promise.resolve({ data: { ...draftData, revision: 3 } }) : undefined));
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    const recovery = within(await screen.findByRole('dialog', { name: 'Restore unsaved local changes?' }));
    await userEvent.setup().click(recovery.getByRole('button', { name: 'Restore my changes' }));

    await waitFor(() => expect(screen.getAllByText('Recovered text').length).toBeGreaterThan(0));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    // الأساس الأصلي (0) محفوظ ⇒ الخادم عند 3 يكتشف التعارض بدل أن تُكتب الاستعادة فوق عمل غيرك.
    await clickSave();
    expect((putCalls()[0][1].body as { base_revision: number }).base_revision).toBe(0);
    await conflictDialog();
  });

  it('discarding the offered backup clears it and leaves the editor clean', async () => {
    const edited = JSON.parse(JSON.stringify(draftData.schema));
    edited.pages.home.children[0].children[0].props.text = 'Recovered text';
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema: edited, baseRevision: 0, savedAt: '2026-10-30T09:00:00+00:00' }));
    mockApi();
    render(<AppBuilderWorkspacePage />);
    await screen.findByText('Featured');

    await userEvent.setup().click(within(await screen.findByRole('dialog', { name: 'Restore unsaved local changes?' })).getByRole('button', { name: 'Discard them' }));

    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull();
    expect(screen.queryAllByText('Recovered text')).toHaveLength(0);
    expect(screen.queryAllByText('Unsaved changes')).toHaveLength(0);
  });

  it('a backup identical to the server draft, or belonging to another user, is never offered', async () => {
    window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema: draftData.schema, baseRevision: 0, savedAt: 'x' }));
    const other = JSON.parse(JSON.stringify(draftData.schema));
    other.pages.home.children[0].children[0].props.text = 'Someone else';
    window.localStorage.setItem('awj.appBuilder.draftBackup.v1.u2.app-1', JSON.stringify({ v: 1, appId: 'app-1', userId: 'u2', schema: other, baseRevision: 0, savedAt: 'x' }));
    await openEditor();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull(); // المطابق للخادم يُنظَّف
    expect(window.localStorage.getItem('awj.appBuilder.draftBackup.v1.u2.app-1')).not.toBeNull(); // لا نمسّ عمل مستخدم آخر
  });

  it('while dirty, clicking an internal link asks before leaving; staying keeps the editor and the edits', async () => {
    await openEditor();
    await makeEdit('Bye');

    fireEvent.click(screen.getByText('backToCommerce'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Leave without saving?' }));
    await userEvent.setup().click(dialog.getByRole('button', { name: 'Stay in the editor' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).toBeNull());
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('while clean, links are not intercepted', async () => {
    await openEditor();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByText('backToCommerce').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Ctrl+S saves the draft even while typing in a field, and does nothing when clean', async () => {
    await openEditor();

    const cleanEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(putCalls()).toHaveLength(0);

    await makeEdit('Bye');
    const [textarea] = screen.getAllByDisplayValue('Bye');
    expect(fireEvent.keyDown(textarea, { key: 's', ctrlKey: true })).toBe(false); // منع حوار حفظ الصفحة
    await waitFor(() => expect(putCalls().length).toBe(1));
    await waitFor(() => expect(screen.getAllByText('Saved').length).toBeGreaterThan(0));
  });

  it('a user without apps_builder.manage gets a read-only draft: notice, disabled save, disabled inspector, edits ignored', async () => {
    currentUser.mockReturnValue({ id: 'u3', role: 'staff', permissions: ['apps_builder.view'] });
    await openEditor();

    expect(screen.getByText('Read-only: you do not have permission to edit the draft.')).toBeTruthy();
    expect((screen.getAllByText('Save')[0].closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByLabelText('Undo')[0] as HTMLButtonElement).disabled).toBe(true);

    const desktopTree = screen.getAllByRole('tree')[0];
    await userEvent.setup().click(within(desktopTree).getByText('Text'));
    const [textarea] = await screen.findAllByDisplayValue('Welcome');
    expect(textarea.matches(':disabled')).toBe(true);

    fireEvent.change(textarea, { target: { value: 'Hacked' } });
    expect(screen.queryAllByText('Unsaved changes')).toHaveLength(0);
    expect(putCalls()).toHaveLength(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(putCalls()).toHaveLength(0);
  });

  it('a read-only user cannot add a page: the control is disabled and the selection is left intact', async () => {
    currentUser.mockReturnValue({ id: 'u3', role: 'staff', permissions: ['apps_builder.view'] });
    await openEditor();

    const add = screen.getAllByRole('button', { name: /Add page/i })[0] as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(screen.getAllByText('Featured').length).toBeGreaterThan(0); // الكانفاس لم يُستبدل بصفحة غير موجودة
    expect(screen.queryAllByText('Unsaved changes')).toHaveLength(0);
  });

  it('an owner is never shown the read-only notice', async () => {
    await openEditor();
    expect(screen.queryByText('Read-only: you do not have permission to edit the draft.')).toBeNull();
  });
});
