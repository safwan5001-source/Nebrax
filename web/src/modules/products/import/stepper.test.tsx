// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stepper } from './stepper';

const steps = [
  { key: 'setup', label: 'الإعداد' },
  { key: 'preview', label: 'المعاينة' },
  { key: 'apply', label: 'التطبيق' },
  { key: 'result', label: 'النتيجة' },
];

afterEach(cleanup);

describe('Stepper — تمرير الخطوة النشطة تلقائياً (مراجعة إنتاج/جوال)', () => {
  it('يمرّر الخطوة النشطة إلى المنظور كلما تغيّرت current، بلا اعتمادٍ على وجود scrollIntoView', () => {
    const scrollIntoView = vi.fn();
    // jsdom لا يطبّق scrollIntoView افتراضياً — نزرعها لنتحقّق من الاستدعاء.
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = render(<Stepper steps={steps} current={0} label="الاستيراد" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    );

    rerender(<Stepper steps={steps} current={2} label="الاستيراد" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('لا ينهار إن غابت scrollIntoView من البيئة (متصفّحات/سياقات أقدم)', () => {
    // @ts-expect-error محاكاة بيئة بلا scrollIntoView إطلاقاً.
    delete HTMLElement.prototype.scrollIntoView;

    expect(() => render(<Stepper steps={steps} current={1} label="الاستيراد" />)).not.toThrow();
  });

  it('كل الخطوات الأربع تبقى في الشجرة (قابلة للوصول) حتى عند تضييق الحاوية — لا حذفٌ شرطي', () => {
    render(<Stepper steps={steps} current={3} label="الاستيراد" />);

    // الأربع خطوات موجودة كأزرار — العرض الضيّق يُعالَج بتمرير أفقي داخل
    // الحاوية (overflow-x-auto)، لا بإخفاء خطوات عن الشجرة.
    for (const step of steps) {
      expect(screen.getByRole('button', { name: new RegExp(step.label) })).toBeTruthy();
    }
  });

  it('يعمل بلا أعطال في الاتجاه الإنجليزي (LTR) أيضاً — لا افتراضاً عربياً مُقحماً', () => {
    document.documentElement.dir = 'ltr';
    const englishSteps = [
      { key: 'setup', label: 'Setup' },
      { key: 'preview', label: 'Preview' },
      { key: 'apply', label: 'Apply' },
      { key: 'result', label: 'Result' },
    ];

    render(<Stepper steps={englishSteps} current={1} label="Import" />);
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    document.documentElement.dir = 'rtl';
  });
});
