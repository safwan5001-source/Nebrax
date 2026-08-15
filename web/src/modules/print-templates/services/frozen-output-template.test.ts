import { describe, expect, it } from 'vitest';
import { resolveFrozenOutputDefinition } from './frozen-output-template';

describe('resolveFrozenOutputDefinition', () => {
  it('يفضل تعريف مراجعة PDF المثبتة على تعريف مراجعة الطباعة', () => {
    expect(resolveFrozenOutputDefinition(
      { definition: { footer_text: 'تذييل PDF' } },
      { definition: { footer_text: 'تذييل الطباعة' } },
    )).toEqual({ footer_text: 'تذييل PDF' });
  });

  it('يعود إلى مراجعة الطباعة المثبتة عند غياب تعيين PDF للمستند التاريخي', () => {
    expect(resolveFrozenOutputDefinition(
      null,
      { definition: { footer_text: 'تذييل تاريخي' } },
    )).toEqual({ footer_text: 'تذييل تاريخي' });
  });

  it('لا يختلق تعريفاً عند غياب أي مراجعة مثبتة', () => {
    expect(resolveFrozenOutputDefinition(null, null)).toBeNull();
  });
});
