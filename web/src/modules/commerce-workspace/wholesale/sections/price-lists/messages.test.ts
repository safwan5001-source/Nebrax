import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { priceListsMessages } from './messages';

describe('price list messages', () => {
  it('has matching ar/en keys, no empties, same placeholders', () => expectMessageParity(priceListsMessages.messages));
});
