import { describe, expect, it } from 'vitest';
import { expectMessageParity } from '../../messages/testing';
import { MEMBERSHIP_ACTIONS, MEMBERSHIP_STATUSES } from './api';
import { buyersMessages } from './messages';

describe('buyers messages', () => {
  it('has ar/en parity', () => expectMessageParity(buyersMessages.messages));

  it('names every status, action and decision outcome in both languages', () => {
    for (const locale of ['ar', 'en']) {
      const { label, t } = buyersMessages.forLocale(locale);
      for (const status of MEMBERSHIP_STATUSES) expect(label('status', status)).not.toBe(status);
      for (const action of MEMBERSHIP_ACTIONS) {
        expect(t(`action.${action}` as 'action.approve')).not.toMatch(/^action\./);
        expect(t(`done.${action}` as 'done.approve')).not.toMatch(/^done\./);
      }
    }
  });
});
