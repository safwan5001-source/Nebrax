import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { overviewMessages } from './messages';

describe('overview messages', () => {
  it('has ar/en parity', () => expectMessageParity(overviewMessages.messages));
});
