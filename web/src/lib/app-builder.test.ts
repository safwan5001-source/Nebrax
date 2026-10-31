import { describe, expect, it } from 'vitest';
import {
  addChildComponent,
  addPage,
  createComponentFromDefinition,
  findParentId,
  generateComponentId,
  generatePageId,
  mergeThemeTokens,
  moveSibling,
  removeComponentById,
  removePage,
  reorderChildren,
  setInitialPage,
  themeTokens,
  updateComponentById,
  projectPageRoot,
  updateEditorMetaNode,
  updateEditorMetaPageTitle,
  canonicalizeThemeTokens,
  countNavigationTo,
  readPrimaryColor,
  type AppSchema,
  type AppSchemaComponent,
  type RegistryComponentDefinition,
} from './app-builder';

function tree(): AppSchemaComponent {
  return {
    type: 'Page',
    id: 'root',
    children: [
      { type: 'Text', id: 'a', props: { text: 'A' } },
      { type: 'Section', id: 'b', children: [{ type: 'Text', id: 'c', props: { text: 'C' } }] },
      { type: 'Text', id: 'd', props: { text: 'D' } },
    ],
  };
}

describe('findParentId', () => {
  it('finds the direct parent of a nested node', () => {
    expect(findParentId(tree(), 'c')).toBe('b');
  });
  it('finds the parent of a top-level child', () => {
    expect(findParentId(tree(), 'a')).toBe('root');
  });
  it('returns null for the root itself and for an unknown id', () => {
    expect(findParentId(tree(), 'root')).toBeNull();
    expect(findParentId(tree(), 'missing')).toBeNull();
  });
});

describe('updateComponentById', () => {
  it('replaces a nested node without mutating the original tree', () => {
    const original = tree();
    const updated = updateComponentById(original, 'c', (node) => ({ ...node, props: { text: 'C2' } }));
    expect(updated.children![1].children![0].props?.text).toBe('C2');
    expect(original.children![1].children![0].props?.text).toBe('C');
  });
  it('is a no-op for an id that does not exist', () => {
    const original = tree();
    const updated = updateComponentById(original, 'missing', (node) => ({ ...node, props: {} }));
    expect(updated).toEqual(original);
  });
});

describe('addChildComponent', () => {
  it('appends a new node to the end of a container node children', () => {
    const updated = addChildComponent(tree(), 'b', { type: 'Text', id: 'new' });
    expect(updated.children![1].children!.map((c) => c.id)).toEqual(['c', 'new']);
  });
  it('creates a children array on a node with none yet', () => {
    const withEmptySection: AppSchemaComponent = { type: 'Page', id: 'root', children: [{ type: 'Section', id: 'empty' }] };
    const updated = addChildComponent(withEmptySection, 'empty', { type: 'Text', id: 'first' });
    expect(updated.children![0].children).toEqual([{ type: 'Text', id: 'first' }]);
  });
});

describe('removeComponentById', () => {
  it('removes a top-level node', () => {
    const updated = removeComponentById(tree(), 'a');
    expect(updated.children!.map((c) => c.id)).toEqual(['b', 'd']);
  });
  it('removes a nested node from its parent', () => {
    const updated = removeComponentById(tree(), 'c');
    expect(updated.children![1].children).toEqual([]);
  });
});

describe('reorderChildren', () => {
  it('reorders a parent children array to match the given id order', () => {
    const updated = reorderChildren(tree(), 'root', ['d', 'a', 'b']);
    expect(updated.children!.map((c) => c.id)).toEqual(['d', 'a', 'b']);
  });
  it('drops any id not present among the current children', () => {
    const updated = reorderChildren(tree(), 'root', ['d', 'ghost', 'a', 'b']);
    expect(updated.children!.map((c) => c.id)).toEqual(['d', 'a', 'b']);
  });
});

describe('moveSibling', () => {
  it('moves a node up within its siblings', () => {
    const updated = moveSibling(tree(), 'd', 'up');
    expect(updated.children!.map((c) => c.id)).toEqual(['a', 'd', 'b']);
  });
  it('moves a node down within its siblings', () => {
    const updated = moveSibling(tree(), 'a', 'down');
    expect(updated.children!.map((c) => c.id)).toEqual(['b', 'a', 'd']);
  });
  it('is a no-op at the start/end boundary', () => {
    const original = tree();
    expect(moveSibling(original, 'a', 'up')).toEqual(original);
    expect(moveSibling(original, 'd', 'down')).toEqual(original);
  });
});

describe('generateComponentId', () => {
  it('produces a lowercase-type-prefixed id, unique across calls', () => {
    const first = generateComponentId('ProductCard');
    const second = generateComponentId('ProductCard');
    expect(first.startsWith('productcard-')).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('createComponentFromDefinition', () => {
  it('seeds props from the registry defaults, skipping null defaults', () => {
    const definition: RegistryComponentDefinition = {
      type: 'Text', version: 1, category: 'content', label: { ar: 'نص', en: 'Text' },
      props: [
        { key: 'text', type: 'string', required: false, label: { ar: 'النص', en: 'Text' }, default: '', enum_values: null },
        { key: 'style', type: 'string', required: false, label: { ar: 'الأسلوب', en: 'Style' }, default: 'body', enum_values: ['title', 'body', 'caption'] },
        { key: 'noDefault', type: 'string', required: false, label: { ar: 'بلا افتراضي', en: 'No Default' }, default: null, enum_values: null },
      ],
      children_rule: { kind: 'none', suggested_child_type: null },
      actionable: false, injected_runtime_action_params: [], notes: '', bindable_resources: [],
    };
    const node = createComponentFromDefinition('Text', definition);
    expect(node.type).toBe('Text');
    expect(node.props).toEqual({ text: '', style: 'body' });
  });
  it('omits props entirely when the component has none with a default', () => {
    const definition: RegistryComponentDefinition = {
      type: 'Page', version: 1, category: 'layout', label: { ar: 'الصفحة', en: 'Page' }, props: [],
      children_rule: { kind: 'unboundedAny', suggested_child_type: null },
      actionable: false, injected_runtime_action_params: [], notes: '', bindable_resources: [],
    };
    const node = createComponentFromDefinition('Page', definition);
    expect(node.props).toBeUndefined();
  });
});

function minimalSchema(theme?: AppSchema['theme']): AppSchema {
  return {
    schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0',
    navigation: { initialPageId: 'home' },
    theme,
    pages: { home: { type: 'Page', id: 'home-root' } },
  };
}

describe('themeTokens', () => {
  it('returns an empty object when no theme is set', () => {
    expect(themeTokens(minimalSchema())).toEqual({});
  });
  it('returns the existing tokens map', () => {
    expect(themeTokens(minimalSchema({ tokens: { primaryColor: '#12372a' } }))).toEqual({ primaryColor: '#12372a' });
  });
});

describe('mergeThemeTokens', () => {
  it('adds tokens to a schema with no theme yet', () => {
    const updated = mergeThemeTokens(minimalSchema(), { colorPrimary: '#12372a' });
    expect(updated.theme?.tokens).toEqual({ colorPrimary: '#12372a' });
  });
  it('merges into existing tokens without dropping untouched keys', () => {
    const original = minimalSchema({ tokens: { colorPrimary: '#12372a', radius: 'default' } });
    const updated = mergeThemeTokens(original, { radius: 'sharp' });
    expect(updated.theme?.tokens).toEqual({ colorPrimary: '#12372a', radius: 'sharp' });
    expect(original.theme?.tokens).toEqual({ colorPrimary: '#12372a', radius: 'default' });
  });
});

function twoPageSchema(): AppSchema {
  return {
    schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0',
    navigation: { initialPageId: 'home' },
    pages: {
      home: { type: 'Page', id: 'home-root' },
      about: { type: 'Page', id: 'about-root' },
    },
  };
}

describe('generatePageId', () => {
  it('produces a page-prefixed id, unique across calls', () => {
    const first = generatePageId();
    const second = generatePageId();
    expect(first.startsWith('page-')).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('addPage', () => {
  it('adds a new empty Page root keyed by the given id, without mutating the original', () => {
    const original = minimalSchema();
    const updated = addPage(original, 'page-new');
    expect(updated.pages['page-new']).toEqual({ type: 'Page', id: 'page-new-root', children: [] });
    expect(original.pages['page-new']).toBeUndefined();
  });
});

describe('removePage', () => {
  it('removes a non-home page', () => {
    const updated = removePage(twoPageSchema(), 'about');
    expect(updated.pages.about).toBeUndefined();
    expect(Object.keys(updated.pages)).toEqual(['home']);
  });
  it('is a no-op when removing the current home page', () => {
    const original = twoPageSchema();
    expect(removePage(original, 'home')).toEqual(original);
  });
  it('is a no-op when it is the only page', () => {
    const original = minimalSchema();
    expect(removePage(original, 'home')).toEqual(original);
  });
});

describe('setInitialPage', () => {
  it('sets a declared page as the initial page', () => {
    const updated = setInitialPage(twoPageSchema(), 'about');
    expect(updated.navigation.initialPageId).toBe('about');
  });
  it('is a no-op for an id that does not reference a declared page', () => {
    const original = twoPageSchema();
    expect(setInitialPage(original, 'missing')).toEqual(original);
  });
});

describe('editor meta helpers (AD-05)', () => {
  const root: AppSchemaComponent = {
    type: 'Page', id: 'root',
    children: [
      { type: 'Section', id: 'a', children: [{ type: 'Text', id: 'a1', props: { text: 'x' } }] },
      { type: 'Section', id: 'b', children: [] },
    ],
  };

  it('projectPageRoot drops hidden nodes and their subtrees, never mutates, and returns the same root when nothing is hidden', () => {
    const meta = { v: 1 as const, nodes: { home: { a: { hidden: true as const, name: 'A' } } }, pages: {} };
    const projected = projectPageRoot(root, meta, 'home');
    expect(projected.children?.map((c) => c.id)).toEqual(['b']);
    expect(root.children?.map((c) => c.id)).toEqual(['a', 'b']);
    expect(projectPageRoot(root, null, 'home')).toBe(root);
    expect(projectPageRoot(root, { v: 1, nodes: { home: { a: { name: 'only a name' } } }, pages: {} }, 'home')).toBe(root);
    // نظير بالمعرّف نفسه في صفحة أخرى: لا يتأثر (فرادة المعرّف داخل الصفحة وحدها).
    expect(projectPageRoot(root, meta, 'about')).toBe(root);
  });

  it('updateEditorMetaNode sets, trims and clears fields; empty entries and empty meta collapse to null', () => {
    let meta = updateEditorMetaNode(null, 'home', 'a', { name: '  Hero ' });
    expect(meta?.nodes.home.a).toEqual({ name: 'Hero' });
    meta = updateEditorMetaNode(meta, 'home', 'a', { hidden: true, preset: 'text' });
    expect(meta?.nodes.home.a).toEqual({ name: 'Hero', hidden: true, preset: 'text' });
    meta = updateEditorMetaNode(meta, 'about', 'a', { name: 'Same id elsewhere' });
    expect(meta?.nodes.about.a).toEqual({ name: 'Same id elsewhere' });
    expect(meta?.nodes.home.a).toEqual({ name: 'Hero', hidden: true, preset: 'text' }); // مقيَّدة بالصفحة
    meta = updateEditorMetaNode(meta, 'about', 'a', { name: '' });
    expect(meta?.nodes.about).toBeUndefined();
    meta = updateEditorMetaNode(meta, 'home', 'a', { hidden: false, name: '' });
    expect(meta?.nodes.home.a).toEqual({ preset: 'text' });
    expect(updateEditorMetaNode(meta, 'home', 'a', { preset: '' })).toBeNull();
  });

  it('updateEditorMetaNode / PageTitle do not mutate their input', () => {
    const before = { v: 1 as const, nodes: { home: { a: { name: 'A' } } }, pages: { home: { title: 'H' } } };
    const snapshot = JSON.stringify(before);
    updateEditorMetaNode(before, 'home', 'a', { hidden: true });
    updateEditorMetaPageTitle(before, 'home', '');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('updateEditorMetaPageTitle sets and clears a title; clearing the last entry gives null', () => {
    const meta = updateEditorMetaPageTitle(null, 'home', ' Landing ');
    expect(meta?.pages.home).toEqual({ title: 'Landing' });
    expect(updateEditorMetaPageTitle(meta, 'home', '  ')).toBeNull();
  });
});

describe('canonical theme tokens (AD-03 / S04b)', () => {
  it('readPrimaryColor: canonical colorPrimary wins, legacy primaryColor is a read-only synonym, first VALID wins, nothing valid is null', () => {
    expect(readPrimaryColor({ colorPrimary: '#1E3A5F' })).toBe('#1E3A5F');
    expect(readPrimaryColor({ primaryColor: '#B45309' })).toBe('#B45309');
    expect(readPrimaryColor({ colorPrimary: '#1E3A5F', primaryColor: '#B45309' })).toBe('#1E3A5F');
    expect(readPrimaryColor({ colorPrimary: 'teal', primaryColor: '#B45309' })).toBe('#B45309');
    const invalid: Array<Record<string, string> | undefined> = [{}, { colorPrimary: '' }, { colorPrimary: '#FFF' }, { colorPrimary: 'red', primaryColor: 'blue' }, undefined];
    for (const bad of invalid) {
      expect(readPrimaryColor(bad)).toBeNull();
    }
    expect(readPrimaryColor({ colorPrimary: '  #1e3a5f ' })).toBe('#1e3a5f'); // مرآة Dart: يُقصّ
  });

  it('canonicalizeThemeTokens renames the legacy key, drops derived CSS variables, keeps everything else, and does not mutate', () => {
    const input = { primaryColor: '#B45309', '--primary': '#B45309', '--store-radius': '8px', radius: 'sharp', themePreset: 'navy' };
    const snapshot = JSON.stringify(input);
    expect(canonicalizeThemeTokens(input)).toEqual({ colorPrimary: '#B45309', radius: 'sharp', themePreset: 'navy' });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('canonicalizeThemeTokens: an existing valid colorPrimary wins over a stale legacy key, and an invalid legacy value is dropped, not promoted', () => {
    expect(canonicalizeThemeTokens({ colorPrimary: '#1E3A5F', primaryColor: '#B45309' })).toEqual({ colorPrimary: '#1E3A5F' });
    expect(canonicalizeThemeTokens({ primaryColor: 'not-a-color', radius: 'sharp' })).toEqual({ radius: 'sharp' });
  });

  it('mergeThemeTokens canonicalizes on write (legacy drafts migrate on the next theme edit, never in bulk)', () => {
    const legacy = minimalSchema({ tokens: { primaryColor: '#12372a', '--primary': '#12372a', radius: 'default' } });
    const updated = mergeThemeTokens(legacy, { radius: 'sharp' });
    expect(updated.theme?.tokens).toEqual({ colorPrimary: '#12372a', radius: 'sharp' });
    expect(legacy.theme?.tokens).toEqual({ primaryColor: '#12372a', '--primary': '#12372a', radius: 'default' });
    // لا تعديل ⇒ لا إعادة كتابة: القراءة وحدها لا تمسّ شيئاً.
    expect(themeTokens(legacy)).toEqual({ primaryColor: '#12372a', '--primary': '#12372a', radius: 'default' });
  });
});

describe('countNavigationTo (S21b)', () => {
  const schema = {
    schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0', navigation: { initialPageId: 'home' },
    pages: {
      home: { type: 'Page', id: 'r', children: [
        { type: 'Button', id: 'b1', action: { type: 'navigate', params: { pageId: 'cart' } } },
        { type: 'Section', id: 's', children: [{ type: 'Button', id: 'b2', action: { type: 'navigate', params: { pageId: 'cart' } } }, { type: 'Button', id: 'b3', action: { type: 'openProduct', params: { productId: 'cart' } } }] },
      ] },
      cart: { type: 'Page', id: 'c', children: [{ type: 'Button', id: 'b4', action: { type: 'navigate', params: { pageId: 'home' } } }] },
    },
  } as AppSchema;

  it('counts only navigate actions to that page, at any depth and from any page', () => {
    expect(countNavigationTo(schema, 'cart')).toBe(2);
    expect(countNavigationTo(schema, 'home')).toBe(1);
    expect(countNavigationTo(schema, 'ghost')).toBe(0);
  });

  it('ignores references inside the page itself: they disappear with it and never become dangling (review P2)', () => {
    const selfRef = {
      ...schema,
      pages: {
        ...schema.pages,
        cart: { type: 'Page', id: 'c', children: [{ type: 'Button', id: 'self', action: { type: 'navigate', params: { pageId: 'cart' } } }, { type: 'Button', id: 'b4', action: { type: 'navigate', params: { pageId: 'home' } } }] },
      },
    } as AppSchema;
    expect(countNavigationTo(selfRef, 'cart')).toBe(2); // الإحالتان من home فقط، لا الذاتية
    expect(countNavigationTo(selfRef, 'home')).toBe(1);
  });
});
