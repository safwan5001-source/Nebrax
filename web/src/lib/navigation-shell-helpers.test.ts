import { describe, expect, it } from 'vitest';
import {
  addNavTab, moveNavTab, removeNavTab, removePage, setAppBar, setNavTabs, updateNavTab, visibleTabCount,
  type AppSchema,
} from './app-builder';

const page = (id: string) => ({ type: 'Page', id: `${id}-root`, children: [] });
const schema = (navigation: Record<string, unknown> = {}): AppSchema => ({
  schemaVersion: '1.0.0',
  minRuntimeVersion: '1.0.0',
  theme: { tokens: {} },
  navigation: { initialPageId: 'home', ...navigation },
  pages: { home: page('home'), shop: page('shop'), about: page('about'), p4: page('p4'), p5: page('p5'), p6: page('p6') },
} as unknown as AppSchema);

describe('navigation shell helpers (AD-04 / S09d)', () => {
  it('addNavTab appends a tab for a page with a default icon and the given title', () => {
    const next = addNavTab(schema(), 'shop', 'المتجر');
    expect(next?.navigation.tabs).toEqual([{ pageId: 'shop', title: 'المتجر', icon: 'home' }]);
  });

  it('title is clamped to the limit and a page cannot get two tabs', () => {
    const long = 'ا'.repeat(40);
    const one = addNavTab(schema(), 'shop', long)!;
    expect(one.navigation.tabs![0].title).toHaveLength(24);
    expect(addNavTab(one, 'shop', 'x')).toBeNull();
  });

  it('an undeclared page cannot get a tab', () => {
    expect(addNavTab(schema(), 'ghost', 'x')).toBeNull();
  });

  it('the sixth visible tab is refused, but a hidden one is allowed', () => {
    let s: AppSchema = schema();
    for (const id of ['home', 'shop', 'about', 'p4', 'p5']) s = addNavTab(s, id, `ت${id}`)!;
    expect(visibleTabCount(s)).toBe(5);
    expect(addNavTab(s, 'p6', 'x')).toBeNull();
    const hidden = addNavTab(s, 'p6', 'x', { hidden: true });
    expect(hidden?.navigation.tabs).toHaveLength(6);
    expect(visibleTabCount(hidden!)).toBe(5);
  });

  it('updateNavTab edits title/icon/hidden; making the sixth tab visible is refused', () => {
    let s: AppSchema = schema();
    for (const id of ['home', 'shop', 'about', 'p4', 'p5']) s = addNavTab(s, id, `ت${id}`)!;
    s = addNavTab(s, 'p6', 'x', { hidden: true })!;
    const edited = updateNavTab(s, 'shop', { title: 'جديد', icon: 'store' })!;
    expect(edited.navigation.tabs!.find((t) => t.pageId === 'shop')).toMatchObject({ title: 'جديد', icon: 'store' });
    expect(updateNavTab(s, 'p6', { hidden: false })).toBeNull();
    expect(updateNavTab(s, 'ghost', { title: 'z' })).toBeNull();
  });

  it('removeNavTab drops the key entirely when the last tab goes', () => {
    const s = addNavTab(schema(), 'shop', 'x')!;
    const next = removeNavTab(s, 'shop');
    expect('tabs' in next.navigation).toBe(false);
    expect(next.navigation.initialPageId).toBe('home');
  });

  it('moveNavTab reorders within bounds only', () => {
    let s: AppSchema = schema();
    for (const id of ['home', 'shop', 'about']) s = addNavTab(s, id, id)!;
    expect(moveNavTab(s, 'shop', 'up').navigation.tabs!.map((t) => t.pageId)).toEqual(['shop', 'home', 'about']);
    expect(moveNavTab(s, 'home', 'up')).toBe(s);
    expect(moveNavTab(s, 'about', 'down')).toBe(s);
  });

  it('setNavTabs([]) removes the key; setAppBar normalizes empty to no key and keeps meaningful fields', () => {
    const s = addNavTab(schema(), 'shop', 'x')!;
    expect('tabs' in setNavTabs(s, []).navigation).toBe(false);
    expect('appBar' in setAppBar(schema(), {}).navigation).toBe(false);
    expect('appBar' in setAppBar(schema(), undefined).navigation).toBe(false);
    expect(setAppBar(schema(), { title: 'متجري', showCart: true }).navigation.appBar).toEqual({ title: 'متجري', showCart: true });
    expect(setAppBar(schema(), { title: '   ' }).navigation.appBar).toBeUndefined();
    expect(setAppBar(schema(), { showCart: false }).navigation.appBar).toEqual({ showCart: false });
  });

  it('appBar title is clamped to 40 chars', () => {
    expect(setAppBar(schema(), { title: 'a'.repeat(60) }).navigation.appBar?.title).toHaveLength(40);
  });

  it('removing a page also removes its tab (no dangling tab_page_missing)', () => {
    let s: AppSchema = schema();
    s = addNavTab(s, 'home', 'ر')!;
    s = addNavTab(s, 'shop', 'م')!;
    const next = removePage(s, 'shop');
    expect(next.pages.shop).toBeUndefined();
    expect(next.navigation.tabs?.map((t) => t.pageId)).toEqual(['home']);
    const last = removePage(addNavTab(schema(), 'about', 'x')!, 'about');
    expect('tabs' in last.navigation).toBe(false);
  });

  it('setAppBar keeps the raw text while the merchant types (spaces inside and trailing) and drops a blank title', () => {
    expect(setAppBar(schema(), { title: 'My ' }).navigation.appBar?.title).toBe('My ');
    expect(setAppBar(schema(), { title: 'My Store' }).navigation.appBar?.title).toBe('My Store');
    expect(setAppBar(schema(), { title: ' ' }).navigation.appBar).toBeUndefined();
    expect(setAppBar(schema(), { title: '   ', showCart: true }).navigation.appBar).toEqual({ showCart: true });
  });
});
