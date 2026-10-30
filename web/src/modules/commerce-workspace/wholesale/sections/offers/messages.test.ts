import { describe, expect, it } from 'vitest';
import { KNOWN_OFFER_REASONS } from '@/modules/commerce-workspace/workspace-offers';
import { expectMessageParity } from '../../messages/testing';
import { offersMessages } from './messages';

describe('offers messages', () => {
  it('has matching ar/en keys, no empties, same placeholders', () => expectMessageParity(offersMessages.messages));

  it('translates every server reason the resolver can return', () => {
    for (const locale of ['ar', 'en']) {
      const { label } = offersMessages.forLocale(locale);
      for (const reason of KNOWN_OFFER_REASONS) expect(label('reason', reason)).not.toBe(reason);
    }
  });
});
