import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMUNICATION_CHANNEL_ORDER,
  COMMUNICATION_PROVIDERS,
  PROVIDER_STATUS_ORDER,
  communicationProvider,
  providersByChannel,
} from '@/lib/communications-providers';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const REPO = join(WEB, '..');

describe('communications provider registry (AWJ-COMMS-UX-01)', () => {
  it('has unique keys and covers every channel', () => {
    const keys = COMMUNICATION_PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const channel of COMMUNICATION_CHANNEL_ORDER) expect(providersByChannel(channel).length).toBeGreaterThan(0);
    expect(communicationProvider('unifonic')?.channel).toBe('sms');
    expect(communicationProvider('nope')).toBeNull();
  });

  it('can never claim a connected or active provider: only the three descriptive statuses exist', () => {
    expect([...PROVIDER_STATUS_ORDER]).toEqual(['theoretical', 'planned', 'owner_approval']);
    for (const provider of COMMUNICATION_PROVIDERS) {
      expect(PROVIDER_STATUS_ORDER).toContain(provider.status);
      expect(Object.keys(provider)).not.toEqual(expect.arrayContaining(['connected', 'active', 'enabled']));
    }
  });

  it('adopts no key, secret or endpoint: identity evidence is a public https page only', () => {
    for (const provider of COMMUNICATION_PROVIDERS) {
      expect(provider.identityUrl, provider.key).toMatch(/^https:\/\/[a-z0-9.-]+\/[\w\-./]*$/i);
      expect(JSON.stringify(provider), provider.key).not.toMatch(/api[_-]?key|secret|token|password/i);
    }
  });

  it('planned and owner-approval statuses cite an AWJ document that exists in the repository', () => {
    for (const provider of COMMUNICATION_PROVIDERS.filter((p) => p.status !== 'theoretical')) {
      expect(provider.awjEvidence, provider.key).not.toBeNull();
      const paths = [...(provider.awjEvidence ?? '').matchAll(/(?:app|docs)\/[\w/.-]+\.(?:php|md)/g)].map((m) => m[0]);
      expect(paths.length, provider.key).toBeGreaterThan(0);
      for (const path of paths) expect(existsSync(join(REPO, path)), `${provider.key}: ${path}`).toBe(true);
    }
    for (const provider of COMMUNICATION_PROVIDERS.filter((p) => p.status === 'theoretical')) expect(provider.awjEvidence).toBeNull();
  });

  it('every logo is either a documented official asset that exists on disk, or a generic icon with a documented gap', () => {
    for (const provider of COMMUNICATION_PROVIDERS) {
      if (provider.logo.kind === 'official') {
        expect(provider.logo.src, provider.key).toMatch(/^\/[\w\-./]+$/);
        expect(provider.logo.source.length, provider.key).toBeGreaterThan(20);
        expect(provider.logo.license.length, provider.key).toBeGreaterThan(20);
        expect(existsSync(join(WEB, 'public', provider.logo.src)), `${provider.key}: ${provider.logo.src}`).toBe(true);
      } else {
        expect(provider.logo.gap.length, provider.key).toBeGreaterThan(20);
      }
    }
  });

  it('the only official logo is the unmodified WhatsApp glyph already committed for the storefront footer', () => {
    const official = COMMUNICATION_PROVIDERS.filter((p) => p.logo.kind === 'official');
    expect(official.map((p) => p.key)).toEqual(['whatsapp-business-platform']);
    // لا نسخة جديدة: المسار هو الأصل القائم نفسه، فلا يمكن أن ينحرف عنه بايتاً.
    expect(official[0].logo.kind === 'official' && official[0].logo.src).toBe('/brand/social/whatsapp.svg');
    expect(readFileSync(join(WEB, 'public/brand/social/whatsapp.svg')).length).toBeGreaterThan(0);
  });
});
