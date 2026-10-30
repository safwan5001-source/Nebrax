import { describe, expect, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { QUOTE_STATUSES } from './api';
import { quotationsMessages } from './messages';

describe('quotations messages', () => {
  it('has matching ar/en keys, no empties, same placeholders', () => expectMessageParity(quotationsMessages.messages));

  it('names every quote status in both languages', () => {
    for (const locale of ['ar', 'en']) {
      const { label } = quotationsMessages.forLocale(locale);
      for (const status of QUOTE_STATUSES) expect(label('status', status)).not.toBe(status);
    }
  });
});
