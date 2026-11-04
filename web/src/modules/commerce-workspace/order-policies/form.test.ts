import { describe, expect, it } from 'vitest';
import { HOLD_DEFAULT_MINUTES, HOLD_MAX_MINUTES, HOLD_MIN_MINUTES, validateHoldMinutes } from './form';

describe('validateHoldMinutes (COPS-H4-5)', () => {
  it('mirrors the server bounds and default', () => {
    expect([HOLD_MIN_MINUTES, HOLD_MAX_MINUTES, HOLD_DEFAULT_MINUTES]).toEqual([15, 1440, 60]);
  });

  it.each([['15', 15], ['60', 60], ['1440', 1440], ['  90  ', 90], ['٣٠', 30], ['۴۵', 45]])('accepts %j as %i minutes', (input, minutes) => {
    expect(validateHoldMinutes(input)).toEqual({ ok: true, minutes });
  });

  it.each([['', 'required'], ['   ', 'required'], ['abc', 'integer'], ['1.5', 'integer'], ['-30', 'integer'], ['+30', 'integer'], ['1e3', 'integer'], ['30 min', 'integer'], ['14', 'range'], ['0', 'range'], ['1441', 'range'], ['99999999999999999999', 'range']])(
    'rejects %j as %s',
    (input, error) => {
      expect(validateHoldMinutes(input)).toEqual({ ok: false, error });
    },
  );
});
