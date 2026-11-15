import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATION_OPS_MANIFEST_PATH, stationOpsPwaMetadata } from './pwa-metadata';

/**
 * معايير قابلية التثبيت في Chrome/Android (web.dev/install-criteria): name/short_name، أيقونة PNG ≥192 و≥512،
 * start_url داخل scope، display ∈ {standalone, fullscreen, minimal-ui}، وhttps. الاختبار يقرأ الملفات الفعلية
 * (لا نسخة منها) فيفشل إن حُذفت الأيقونة أو انحرف النطاق عن مسار التطبيق.
 */
const publicDir = path.join(process.cwd(), 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, STATION_OPS_MANIFEST_PATH), 'utf8')) as {
  id: string; name: string; short_name: string; start_url: string; scope: string; display: string;
  theme_color: string; background_color: string; lang: string; dir: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('AWJ Fuel Stations PWA manifest (Android Chrome installability)', () => {
  it('has the identity fields Chrome requires', () => {
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(manifest.id.startsWith('/fuel-stations/ops')).toBe(true);
  });

  it('keeps start_url inside scope and scope inside the station app path', () => {
    expect(manifest.scope.startsWith('/fuel-stations/ops')).toBe(true);
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    // البداية = جذر التطبيق (بلا بارامترات تخص مستأجراً ولا وجهة مصادَقة) والحارس يحوّل غير المصادَق إلى الدخول.
    expect(manifest.start_url).toBe('/fuel-stations/ops');
  });

  it('ships real PNG icons: 192, 512 and a maskable 512', () => {
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(icon.src.startsWith('/')).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(path.join(publicDir, icon.src))).toEqual({ w, h });
    }
    const any = manifest.icons.filter((i) => (i.purpose ?? 'any') === 'any').map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    // الأيقونة القابلة للقناع لا تُستعمل كـ any (يُقصّ الشعار) ولا يُجمَع الغرضان في أيقونة واحدة.
    expect(manifest.icons.every((i) => !/any.*maskable|maskable.*any/.test(i.purpose ?? ''))).toBe(true);
  });

  it('links the manifest and static PNG icons (not the dynamic tenant icon) from the station layouts', () => {
    expect(stationOpsPwaMetadata.manifest).toBe(STATION_OPS_MANIFEST_PATH);
    expect(JSON.stringify(stationOpsPwaMetadata.icons)).not.toContain('company-browser-icon');
    for (const group of ['(fuel-ops)', '(fuel-ops-auth)']) {
      const src = fs.readFileSync(path.join(process.cwd(), 'src/app', group, 'layout.tsx'), 'utf8');
      expect(src).toContain('...stationOpsPwaMetadata');
      expect(src).toContain('stationOpsViewport');
    }
    expect(fs.existsSync(path.join(publicDir, 'fuel-ops-pwa/apple-touch-icon.png'))).toBe(true);
  });

  it('uses theme colours that match the app shell tokens', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/modules/station-ops/fuel-ops.css'), 'utf8');
    expect(css).toContain(`--fo-navy: ${manifest.theme_color}`);
    expect(css).toContain(`--background: ${manifest.background_color}`);
  });
});
