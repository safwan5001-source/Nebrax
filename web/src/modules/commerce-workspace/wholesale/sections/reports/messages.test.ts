import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { reportsMessages } from './messages';

describe('reports messages', () => {
  it('has identical keys, no empty values and matching placeholders in ar/en', () => expectMessageParity(reportsMessages.messages));
});
