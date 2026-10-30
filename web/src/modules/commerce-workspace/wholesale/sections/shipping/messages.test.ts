import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { shippingMessages } from './messages';

describe('shipping messages', () => {
  it('has identical keys, no empty values and matching placeholders in ar/en', () => expectMessageParity(shippingMessages.messages));
});
