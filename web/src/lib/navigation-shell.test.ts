import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_LIMITS, NAV_TAB_ICONS } from './app-builder';

/** AD-04 / S09a — حدود وأيقونات غلاف التنقل في الويب تطابق الملف المشترك مع PHP وDart. */
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), '../contracts/app-builder/navigation-shell.v1.json'), 'utf8')) as {
  limits: { icons: string[]; max_tabs: number; max_visible_tabs: number; max_tab_title: number; max_app_bar_title: number };
};

describe('navigation shell contract (web)', () => {
  it('icons and limits equal the shared fixture', () => {
    expect([...NAV_TAB_ICONS]).toEqual(fixture.limits.icons);
    expect(NAV_LIMITS.maxTabs).toBe(fixture.limits.max_tabs);
    expect(NAV_LIMITS.maxVisibleTabs).toBe(fixture.limits.max_visible_tabs);
    expect(NAV_LIMITS.maxTabTitle).toBe(fixture.limits.max_tab_title);
    expect(NAV_LIMITS.maxAppBarTitle).toBe(fixture.limits.max_app_bar_title);
  });
});
