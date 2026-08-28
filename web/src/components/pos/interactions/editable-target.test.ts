// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { isPosEditableTarget } from './editable-target';

afterEach(() => { document.body.innerHTML = ''; });

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe('اكتشاف الحقل القابل للتحرير في نقطة البيع', () => {
  it('يعدّ حقول الإدخال ومناطق النص والعناصر القابلة للتحرير كتابةً بشرية', () => {
    expect(isPosEditableTarget(mount('<input />'))).toBe(true);
    expect(isPosEditableTarget(mount('<textarea></textarea>'))).toBe(true);

    const editable = mount('<div contenteditable="true"></div>');
    // jsdom لا يشتقّ `isContentEditable` من السمة، فنثبّتها كما يفعل المتصفح.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(isPosEditableTarget(editable)).toBe(true);
  });

  it('لا يعدّ الجسم ولا الأزرار ولا القوائم كتابةً، فيبقى المسح عاملاً دونها', () => {
    expect(isPosEditableTarget(document.body)).toBe(false);
    expect(isPosEditableTarget(mount('<button type="button"></button>'))).toBe(false);
    expect(isPosEditableTarget(mount('<select></select>'))).toBe(false);
    expect(isPosEditableTarget(null)).toBe(false);
  });
});
