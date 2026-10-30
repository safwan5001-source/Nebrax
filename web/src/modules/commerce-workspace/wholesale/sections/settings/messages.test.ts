import { describe, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { settingsMessages } from './messages';

describe('settings messages', () => {
  it('has identical keys, no empty values and matching placeholders in ar/en', () => expectMessageParity(settingsMessages.messages));
});
