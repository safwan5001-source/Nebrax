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
      type: 'Text', version: 1, category: 'content',
      props: [
        { key: 'text', type: 'string', required: false, default: '', enum_values: null },
        { key: 'style', type: 'string', required: false, default: 'body', enum_values: ['title', 'body', 'caption'] },
        { key: 'noDefault', type: 'string', required: false, default: null, enum_values: null },
      ],
      children_rule: { kind: 'none', suggested_child_type: null },
      actionable: false, injected_runtime_action_params: [], notes: '',
    };
    const node = createComponentFromDefinition('Text', definition);
    expect(node.type).toBe('Text');
    expect(node.props).toEqual({ text: '', style: 'body' });
  });
  it('omits props entirely when the component has none with a default', () => {
    const definition: RegistryComponentDefinition = {
      type: 'Page', version: 1, category: 'layout', props: [],
      children_rule: { kind: 'unboundedAny', suggested_child_type: null },
      actionable: false, injected_runtime_action_params: [], notes: '',
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
    const updated = mergeThemeTokens(minimalSchema(), { primaryColor: '#12372a' });
    expect(updated.theme?.tokens).toEqual({ primaryColor: '#12372a' });
  });
  it('merges into existing tokens without dropping untouched keys', () => {
    const original = minimalSchema({ tokens: { primaryColor: '#12372a', radius: 'default' } });
    const updated = mergeThemeTokens(original, { radius: 'sharp' });
    expect(updated.theme?.tokens).toEqual({ primaryColor: '#12372a', radius: 'sharp' });
    expect(original.theme?.tokens).toEqual({ primaryColor: '#12372a', radius: 'default' });
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
