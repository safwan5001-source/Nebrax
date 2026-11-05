// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FUEL_ICONS, FUEL_ICON_IDS, FuelIcon, detectFuelGrade, fuelIconLabel, fuelIconSources, isFuelIconId, resolveFuelIcon, resolvePumpIcon } from './index';

afterEach(cleanup);

const PUB = resolve(__dirname, '../../../public/fuel-icons/v2');

describe('fuel icon assets (official, vendored verbatim)', () => {
  it('registry has exactly the 20 approved icons, matching the upstream manifest', () => {
    expect(FUEL_ICON_IDS).toHaveLength(20);
    const manifest = JSON.parse(readFileSync(resolve(PUB, 'icons.json'), 'utf8')) as Array<{ id: string; ar: string; en: string }>;
    expect(manifest.map((m) => m.id).sort()).toEqual([...FUEL_ICON_IDS].sort());
    for (const m of manifest) {
      expect(isFuelIconId(m.id)).toBe(true);
      expect(FUEL_ICONS[m.id as keyof typeof FUEL_ICONS].id).toBe(m.id);
      // التسميات الأصلية محفوظة حرفياً حيث لم يتغيّر معناها (تسميات الخزان/الديزل مُكمَلة بعد الحزمة).
      expect(fuelIconLabel(m.id as never, 'ar')).toBeTruthy();
      expect(fuelIconLabel(m.id as never, 'en')).toBeTruthy();
    }
  });

  it('every icon has png + sm + svg files and the originals match the shipped checksums (artwork untouched)', () => {
    const sums = JSON.parse(readFileSync(resolve(PUB, 'checksums.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(sums)).toHaveLength(40);
    for (const id of FUEL_ICON_IDS) {
      for (const rel of [`png/${id}.png`, `sm/${id}.png`, `svg/${id}.svg`]) expect(existsSync(resolve(PUB, rel)), rel).toBe(true);
      for (const rel of [`png/${id}.png`, `svg/${id}.svg`]) {
        expect(createHash('sha256').update(readFileSync(resolve(PUB, rel))).digest('hex'), rel).toBe(sums[rel]);
      }
    }
    expect(readdirSync(resolve(PUB, 'png'))).toHaveLength(20);
  });

  it('PNG originals are 320×256 RGBA and sm variants 128×102 (aspect preserved)', () => {
    const dims = (file: string) => {
      const b = readFileSync(file);
      return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
    };
    for (const id of FUEL_ICON_IDS) {
      expect(dims(resolve(PUB, `png/${id}.png`))).toEqual({ w: 320, h: 256, colorType: 6 });
      expect(dims(resolve(PUB, `sm/${id}.png`))).toEqual({ w: 128, h: 102, colorType: 6 });
    }
  });

  it('sources point at served paths under /fuel-icons/v2', () => {
    expect(fuelIconSources('diesel')).toEqual({ full: '/fuel-icons/v2/png/diesel.png', small: '/fuel-icons/v2/sm/diesel.png' });
  });
});

describe('resolveFuelIcon (display-only, no hard-coded catalog)', () => {
  it('maps unambiguous 91/95/diesel to the matching family per role', () => {
    expect(resolveFuelIcon('product', { code: 'G91', name: 'بنزين 91' })).toBe('gasoline-91');
    expect(resolveFuelIcon('pump', { code: 'X', name: 'Gasoline 95' })).toBe('pump-95');
    expect(resolveFuelIcon('nozzle', { code: 'DSL', name: 'ديزل' })).toBe('nozzle-diesel');
    expect(resolveFuelIcon('tank', { code: 'T', name: 'Diesel' })).toBe('tank-diesel');
  });

  it('normalizes Arabic-Indic and Persian digits', () => {
    expect(detectFuelGrade('بنزين ٩١')).toBe('91');
    expect(detectFuelGrade('بنزين ۹۵')).toBe('95');
  });

  it('never guesses: unknown, multi-grade or other grades fall back to the neutral icon', () => {
    expect(resolveFuelIcon('product', { code: 'X98', name: 'Premium 98' })).toBe('fuel-product');
    expect(resolveFuelIcon('product', { code: '910', name: 'Premium' })).toBe('fuel-product');
    expect(resolveFuelIcon('product', { code: '91-95', name: 'mixed' })).toBe('fuel-product');
    expect(resolveFuelIcon('product', null)).toBe('fuel-product');
    expect(resolveFuelIcon('product', undefined)).toBe('fuel-product');
    expect(resolveFuelIcon('tank', null)).toBe('storage-tanks');
    expect(resolveFuelIcon('pump', null)).toBe('fuel-pump');
  });
});

describe('resolvePumpIcon (connected nozzle products)', () => {
  it('selects the correct pump icon for one known grade', () => {
    expect(resolvePumpIcon([{ name: 'بنزين 91' }])).toBe('pump-91');
    expect(resolvePumpIcon([{ name: 'Gasoline 95' }, { name: 'بنزين ٩٥' }])).toBe('pump-95');
    expect(resolvePumpIcon([{ name: 'ديزل' }])).toBe('pump-diesel');
  });

  it('uses a neutral pump for mixed grades, missing or unknown product and empty nozzle list', () => {
    expect(resolvePumpIcon([{ name: 'بنزين 91' }, { name: 'بنزين 95' }])).toBe('fuel-pump');
    expect(resolvePumpIcon([{ name: 'بنزين 91' }, null])).toBe('fuel-pump');
    expect(resolvePumpIcon([{ name: 'بنزين 98' }])).toBe('fuel-pump');
    expect(resolvePumpIcon([])).toBe('fuel-pump');
  });
});

describe('FuelIcon', () => {
  it('is decorative by default (empty alt, hidden from assistive tech)', () => {
    const { container } = render(<FuelIcon id="gasoline-91" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(container.querySelector('[data-fuel-icon]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes a localized label (ar/en) when asked, without aria-hidden', () => {
    const ar = render(<FuelIcon id="pump-95" labelled locale="ar" />);
    expect(ar.container.querySelector('img')!.getAttribute('alt')).toBe('مضخة بنزين 95');
    expect(ar.container.querySelector('[data-fuel-icon]')!.hasAttribute('aria-hidden')).toBe(false);
    cleanup();
    const en = render(<FuelIcon id="pump-95" labelled locale="en" />);
    expect(en.container.querySelector('img')!.getAttribute('alt')).toBe('Gasoline 95 pump');
    cleanup();
    expect(render(<FuelIcon id="diesel" label="Custom" />).container.querySelector('img')!.getAttribute('alt')).toBe('Custom');
  });

  it('serves sm + full via srcSet and keeps the native 5:4 aspect without recoloring', () => {
    const { container } = render(<FuelIcon id="tank-91" size={64} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('srcset')).toBe('/fuel-icons/v2/sm/tank-91.png 128w, /fuel-icons/v2/png/tank-91.png 320w');
    expect(img.getAttribute('sizes')).toBe('64px');
    expect((container.querySelector('[data-fuel-icon]') as HTMLElement).style.height).toBe('51px');
    expect(img.getAttribute('width')).toBe('320');
    expect(img.getAttribute('height')).toBe('256');
  });

  it('plate: auto = dark only via the host token; always/never explicit; falls back to host semantic tokens (no raw hex)', () => {
    const auto = render(<FuelIcon id="diesel" />).container.firstElementChild!.className;
    expect(auto).toContain('dark:bg-[var(--awj-fuel-icon-plate,var(--text))]');
    expect(auto).toContain('dark:p-[var(--fi-pad)]');
    expect(auto).not.toMatch(/p-\[\d+%\]/); // لا حشوة مئوية (تُحسب من عرض الأب)
    expect(auto).not.toMatch(/(^|\s)bg-\[/);
    cleanup();
    expect(render(<FuelIcon id="diesel" plate="always" />).container.firstElementChild!.className).toMatch(/(^|\s)bg-\[var\(--awj-fuel-icon-plate/);
    cleanup();
    const never = render(<FuelIcon id="diesel" plate="never" />).container.firstElementChild!.className;
    expect(never).not.toContain('--awj-fuel-icon-plate');
  });

  it('renders identically under RTL and LTR (pictograms and 91/95 numerals are never mirrored)', () => {
    const markup = (dir: 'rtl' | 'ltr') => {
      const { container } = render(<div dir={dir}><FuelIcon id="nozzle-91" size={48} /></div>);
      const html = container.querySelector('[data-fuel-icon]')!.outerHTML;
      cleanup();
      return html;
    };
    expect(markup('rtl')).toBe(markup('ltr'));
    const src = readFileSync(resolve(__dirname, 'fuel-icon.tsx'), 'utf8');
    expect(src).not.toMatch(/rtl:|scale-x|scaleX|rotate/);
  });
});

describe('design-system independence (AWJ ERP / Fuel Ops stay separate)', () => {
  const root = resolve(__dirname, '../..');
  it('the shared library imports no app module, token file or messages', () => {
    for (const file of ['registry.ts', 'resolve.ts', 'fuel-icon.tsx', 'index.ts']) {
      const src = readFileSync(resolve(__dirname, file), 'utf8');
      expect(src, file).not.toMatch(/from '@\/(modules|app|components|messages)/);
      expect(src, file).not.toMatch(/--fo-|data-fuel-ops/);
    }
  });

  it('each host resolves the plate from ITS OWN tokens (Fuel Ops explicitly in fuel-ops.css; ERP via the semantic fallback) and no global token is touched', () => {
    const ops = readFileSync(resolve(root, 'modules/station-ops/fuel-ops.css'), 'utf8');
    expect(ops).toContain('--awj-fuel-icon-plate: var(--background);');
    expect(ops).toContain('--awj-fuel-icon-plate: var(--text);');
    expect(readFileSync(resolve(root, 'app/globals.css'), 'utf8')).not.toContain('awj-fuel-icon');
    // ERP لا يعرّف شيئاً: يرث احتياطي المكوّن من رموز ERP الدلالية (`--text`/`--background`)، فلا لون خاص بنظام آخر.
    expect(readFileSync(resolve(root, 'app/(fuel)/fuel-stations/master-data/page.tsx'), 'utf8')).not.toContain('awj-fuel-icon-plate');
    expect(readFileSync(resolve(__dirname, 'fuel-icon.tsx'), 'utf8')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
