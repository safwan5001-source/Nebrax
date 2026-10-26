import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_KEYS, isHexColor, isIconKey, logoPath, resolveVisual } from './visual';

describe('visual — عقد التخصيص البصري', () => {
  it('القائمة البيضاء للأيقونات مطابقة للخادم حرفياً', () => {
    const php = readFileSync(resolve(__dirname, '../../../../../app/Support/PaymentMethodVisual.php'), 'utf8');
    const block = php.match(/ICON_KEYS = \[([\s\S]*?)\];/)?.[1] ?? '';
    const server = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect([...ICON_KEYS].sort()).toEqual([...server].sort());
  });

  it('يقبل #RRGGBB فقط', () => {
    expect(isHexColor('#1A2b3C')).toBe(true);
    for (const bad of ['red', '#FFF', '#GGGGGG', '#1234567', '', null, undefined, 'url(x)', '#12345;}']) expect(isHexColor(bad)).toBe(false);
  });

  it('مفتاح الأيقونة من الخريطة المغلقة فقط', () => {
    expect(isIconKey('wallet')).toBe(true);
    for (const bad of ['skull', 'constructor', '__proto__', 'toString', '', null]) expect(isIconKey(bad)).toBe(false);
  });

  it('البيانات القديمة أو غير الصالحة تسقط إلى الافتراضي', () => {
    expect(resolveVisual({ id: 'a' }).kind).toBe('default');
    expect(resolveVisual({ id: 'a', visual_mode: 'icon', icon_key: 'nope' }).kind).toBe('default');
    expect(resolveVisual({ id: 'a', visual_mode: 'image', has_logo: false }).kind).toBe('default');
    expect(resolveVisual({ id: 'a', visual_mode: 'icon', icon_key: 'wallet', icon_color: 'red' })).toMatchObject({ kind: 'icon', color: null });
    expect(resolveVisual({ id: 'a', visual_mode: 'icon', icon_key: 'wallet', icon_color: '#112233' })).toMatchObject({ kind: 'icon', color: '#112233' });
    expect(resolveVisual({ id: 'a', visual_mode: 'image', has_logo: true }).kind).toBe('image');
  });

  it('مسار الشعار يحمل نسخة التحديث لكسر الكاش عند الاستبدال', () => {
    expect(logoPath({ id: 'x', updated_at: '2026-01-01T00:00:00Z' })).toBe('/payment-methods/x/logo?v=2026-01-01T00%3A00%3A00Z');
    expect(logoPath({ id: 'x' })).toBe('/payment-methods/x/logo');
  });
});

describe('resolveTokenHex — لون محايد من رمز دلالي', () => {
  it('rgbToHex يطبّع القنوات ويقصّها', async () => {
    const { rgbToHex } = await import('./visual');
    expect(rgbToHex(21, 24, 29)).toBe('#15181D');
    expect(rgbToHex(-5, 300, 0.4)).toBe('#00FF00');
  });
});
