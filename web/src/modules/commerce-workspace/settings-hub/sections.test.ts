import { describe, expect, it } from 'vitest';
import { COMMERCE_WORKSPACE_MESSAGES } from '../messages';
import { COMMERCE_WORKSPACE_HREFS } from '../nav';
import { SETTINGS_HUB_SECTIONS, isSettingsSectionVisible, navItemForSection, visibleSettingsSections } from './sections';

const owner = { role: 'owner', permissions: ['*'] };
const hrefs = (viewer: { role?: string; permissions?: string[] } | null, hidden: string[] = []) =>
  visibleSettingsSections(new Set(hidden), viewer).map((section) => section.href);

describe('settings hub sections (COPS-H4-1)', () => {
  it('every card points at an existing workspace navigation entry (single source of truth)', () => {
    for (const section of SETTINGS_HUB_SECTIONS) {
      expect(COMMERCE_WORKSPACE_HREFS, section.href).toContain(section.href);
      expect(navItemForSection(section.href)).toBeDefined();
    }
  });

  it('has unique, never-duplicated targets and does not link the hub to itself or to order screens', () => {
    const all = SETTINGS_HUB_SECTIONS.map((section) => section.href);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('/commerce/settings');
    expect(all.some((href) => href.startsWith('/commerce/orders'))).toBe(false);
  });

  it('owner sees every section', () => {
    expect(hrefs(owner)).toEqual(SETTINGS_HUB_SECTIONS.map((section) => section.href));
  });

  it('a viewer without any permission only sees sections that need none', () => {
    expect(hrefs({ role: 'viewer', permissions: [] })).toEqual(['/commerce/appearance', '/commerce/integrations']);
  });

  it('commerce.manage unlocks domains, delivery and gifting but not customer accounts', () => {
    expect(hrefs({ role: 'viewer', permissions: ['commerce.manage'] })).toEqual([
      '/commerce/appearance',
      '/commerce/domains',
      '/commerce/delivery',
      '/commerce/gifting',
      '/commerce/integrations',
    ]);
  });

  it('customer accounts needs commerce.channel_settings.manage AND an active commerce.storefront capability', () => {
    const viewer = { role: 'viewer', permissions: ['commerce.channel_settings.manage'] };
    expect(hrefs(viewer)).toContain('/commerce/customer-accounts');
    expect(hrefs(viewer, ['commerce.storefront'])).not.toContain('/commerce/customer-accounts');
    // even the owner role is hidden when the capability is off — mirrors the sidebar
    expect(hrefs(owner, ['commerce.storefront'])).not.toContain('/commerce/customer-accounts');
  });

  it('the stricter page-level requirement hides a card the navigation alone would have shown', () => {
    const domains = SETTINGS_HUB_SECTIONS.find((section) => section.href === '/commerce/domains')!;
    expect(navItemForSection(domains.href)?.permission).toBeUndefined();
    expect(isSettingsSectionVisible(domains, new Set(), { role: 'viewer', permissions: [] })).toBe(false);
    expect(isSettingsSectionVisible(domains, new Set(), { role: 'viewer', permissions: ['commerce.manage'] })).toBe(true);
  });

  it('a missing viewer sees nothing that needs a permission', () => {
    expect(hrefs(null)).toEqual(['/commerce/appearance', '/commerce/integrations']);
  });

  it('a section whose navigation entry was removed is never shown', () => {
    expect(
      isSettingsSectionVisible(
        { href: '/commerce/nope', labelKey: 'appearance', descriptionKey: 'settingsHubDescAppearance' },
        new Set(),
        owner,
      ),
    ).toBe(false);
  });

  it('has Arabic and English copy for the hub and for every card', () => {
    for (const locale of ['ar', 'en'] as const) {
      const pack = COMMERCE_WORKSPACE_MESSAGES[locale];
      expect(pack.settingsHub.length).toBeGreaterThan(0);
      expect(pack.settingsHubDescription.length).toBeGreaterThan(0);
      for (const section of SETTINGS_HUB_SECTIONS) {
        expect(pack[section.labelKey].length, `${locale}:${section.labelKey}`).toBeGreaterThan(0);
        expect(pack[section.descriptionKey].length, `${locale}:${section.descriptionKey}`).toBeGreaterThan(0);
      }
    }
  });
});
