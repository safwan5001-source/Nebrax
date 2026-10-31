import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { paymentsMessages } from './messages';

describe('payments messages', () => {
  it('has identical keys, no empty values and matching placeholders in ar/en', () => expectMessageParity(paymentsMessages.messages));
});
