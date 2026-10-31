import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { wholesaleOrdersMessages } from './messages';

describe('wholesale orders messages', () => {
  it('has ar/en parity', () => expectMessageParity(wholesaleOrdersMessages.messages));
});
