import { describe, expect, it } from 'vitest';
import { resolveCategoryVisual } from './pos-category-presentation';

/**
 * PR-2C: يثبت قاعدة «صورة أو لون حصراً» (XOR) — لا يظهران معاً أبداً — وأن
 * تبويب «الكل» يبقى بأيقونته الثابتة بصرف النظر عن الوضع المختار.
 */
describe('resolveCategoryVisual', () => {
  it('يحتفظ تبويب «الكل» بأيقونته الثابتة في كل الأوضاع الثلاثة', () => {
    for (const mode of ['default', 'image', 'color'] as const) {
      expect(resolveCategoryVisual(mode, { isAllTab: true, image: '/img.png', color: '#2563EB' })).toEqual({ kind: 'all-icon' });
    }
  });

  it('وضع «افتراضي»: أيقونة محايدة دوماً، حتى مع وجود صورة ولون معاً', () => {
    const decision = resolveCategoryVisual('default', { isAllTab: false, image: '/img.png', color: '#2563EB' });
    expect(decision).toEqual({ kind: 'neutral-icon' });
  });

  it('وضع «صورة»: يستعمل الصورة ولا يمرّر اللون إطلاقاً (XOR)', () => {
    const decision = resolveCategoryVisual('image', { isAllTab: false, image: '/img.png', color: '#2563EB' });
    expect(decision).toEqual({ kind: 'image', path: '/img.png' });
    expect(decision).not.toHaveProperty('color');
  });

  it('وضع «صورة» بلا صورة: يسقط على fallback الصورة المحايد نفسه (مسار null)', () => {
    const decision = resolveCategoryVisual('image', { isAllTab: false, image: null, color: '#2563EB' });
    expect(decision).toEqual({ kind: 'image', path: null });
  });

  it('وضع «لون»: يستعمل اللون ولا يمرّر الصورة إطلاقاً (XOR)', () => {
    const decision = resolveCategoryVisual('color', { isAllTab: false, image: '/img.png', color: '#2563EB' });
    expect(decision).toEqual({ kind: 'color', color: '#2563EB' });
    expect(decision).not.toHaveProperty('path');
  });

  it('وضع «لون» بلا لون مضبوط: يمرّر null فيسقط المكوّن على fallback محايد', () => {
    const decision = resolveCategoryVisual('color', { isAllTab: false, image: '/img.png', color: null });
    expect(decision).toEqual({ kind: 'color', color: null });
  });
});
