import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { catalogMessages } from './messages';

describe('catalog messages', () => {
  it('has matching ar/en keys, no empties, same placeholders', () => expectMessageParity(catalogMessages.messages));
});
