import { createHash } from 'node:crypto';
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
        expect(provider.logo.restrictions.length, provider.key).toBeGreaterThan(20);
        expect(provider.logo.width, provider.key).toBeGreaterThan(0);
        expect(provider.logo.height, provider.key).toBeGreaterThan(0);
        expect(existsSync(join(WEB, 'public', provider.logo.src)), `${provider.key}: ${provider.logo.src}`).toBe(true);
      } else {
        expect(provider.logo.gap.length, provider.key).toBeGreaterThan(20);
      }
    }
  });

  it('AWJ-COMMS-UX-01 final: eight providers, five official logos, three named gaps', () => {
    expect(COMMUNICATION_PROVIDERS).toHaveLength(8);
    expect(COMMUNICATION_PROVIDERS.filter((p) => p.logo.kind === 'official').map((p) => p.key).sort()).toEqual([
      'firebase-cloud-messaging', 'postmark', 'taqnyat', 'unifonic', 'whatsapp-business-platform',
    ]);
    expect(COMMUNICATION_PROVIDERS.filter((p) => p.logo.kind === 'generic').map((p) => p.key).sort()).toEqual([
      'amazon-ses', 'apple-push-notification-service', 'twilio-sms',
    ]);
    // الفجوتان اللتان سببهما سياسة المالك تنصّان على الإذن الكتابي؛ APNs لا أصل له.
    for (const key of ['twilio-sms', 'amazon-ses']) {
      const logo = communicationProvider(key)!.logo;
      expect(logo.kind === 'generic' && logo.gap, key).toMatch(/إذن كتابي|إذناً كتابياً/);
    }
  });

  it('official logo bytes are exactly the vendor files: sha256 matches and nothing is redrawn, recoloured or cropped', () => {
    for (const provider of COMMUNICATION_PROVIDERS) {
      if (provider.logo.kind !== 'official') continue;
      const bytes = readFileSync(join(WEB, 'public', provider.logo.src));
      expect(createHash('sha256').update(bytes).digest('hex'), provider.key).toBe(provider.logo.sha256);
    }
  });

  it('SVG assets are inert: no script, foreignObject, event handler or external reference', () => {
    for (const provider of COMMUNICATION_PROVIDERS) {
      if (provider.logo.kind !== 'official' || !provider.logo.src.endsWith('.svg')) continue;
      const svg = readFileSync(join(WEB, 'public', provider.logo.src), 'utf8');
      expect(svg, provider.key).not.toMatch(/<script|<foreignObject|\son\w+\s*=|xlink:href|href\s*=\s*["']https?:|url\(\s*["']?https?:|@import/i);
    }
  });

  it('Taqnyat is a Saudi future candidate: SMS, owner approval, no credential or adapter field', () => {
    const taqnyat = communicationProvider('taqnyat')!;
    expect(taqnyat.channel).toBe('sms');
    expect(taqnyat.status).toBe('owner_approval');
    expect(taqnyat.name).toContain('تقنيات');
    expect(Object.keys(taqnyat).sort()).toEqual(['awjEvidence', 'channel', 'identityUrl', 'key', 'logo', 'name', 'status', 'vendor']);
  });

  it('only the unmodified, already-committed WhatsApp glyph is reused from outside /comms-providers', () => {
    const outside = COMMUNICATION_PROVIDERS.filter((p) => p.logo.kind === 'official' && !p.logo.src.startsWith('/comms-providers/'));
    expect(outside.map((p) => p.key)).toEqual(['whatsapp-business-platform']);
    expect(outside[0].logo.kind === 'official' && outside[0].logo.src).toBe('/brand/social/whatsapp.svg');
  });
});
