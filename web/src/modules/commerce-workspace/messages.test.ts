import { describe, expect, it } from 'vitest';
import { COMMERCE_WORKSPACE_MESSAGES, commerceWorkspaceMessage } from './messages';

describe('commerce workspace AR/EN labels', () => {
  it('keeps the approved main navigation labels', () => {
    expect(COMMERCE_WORKSPACE_MESSAGES.ar.title).toBe('التجارة الإلكترونية');
    expect(COMMERCE_WORKSPACE_MESSAGES.en.title).toBe('E-commerce');
    expect(COMMERCE_WORKSPACE_MESSAGES.ar.viewStore).toBe('عرض المتجر');
    expect(COMMERCE_WORKSPACE_MESSAGES.en.viewStore).toBe('View store');
  });

  it('covers every Arabic key in English', () => {
    expect(Object.keys(COMMERCE_WORKSPACE_MESSAGES.en).sort()).toEqual(
      Object.keys(COMMERCE_WORKSPACE_MESSAGES.ar).sort(),
    );
  });

  it('defaults to Arabic when the locale is not English', () => {
    expect(commerceWorkspaceMessage('ar', 'title')).toBe('التجارة الإلكترونية');
    expect(commerceWorkspaceMessage('en-US', 'title')).toBe('E-commerce');
    expect(commerceWorkspaceMessage(undefined, 'backToAwj')).toBe('العودة إلى أَوْج');
  });
});
