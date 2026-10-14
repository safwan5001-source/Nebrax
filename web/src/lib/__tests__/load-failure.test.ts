import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { describeLoadFailure } from '../load-failure';

const messages = { forbidden: 'Not available for your organization or role.', fallback: 'Could not load.' };

describe('describeLoadFailure (ERP-UX-009)', () => {
  it('turns any 403 into the localized forbidden message, never the raw server sentence', () => {
    const failure = describeLoadFailure(new ApiError(403, 'لا تتوفر صلاحية فعالة لهذه القدرة.', {}), messages);
    expect(failure).toEqual({ message: messages.forbidden, forbidden: true });
  });

  it('keeps the server message for other API errors and allows retry', () => {
    expect(describeLoadFailure(new ApiError(422, 'Invalid date range', {}), messages)).toEqual({ message: 'Invalid date range', forbidden: false });
    expect(describeLoadFailure(new ApiError(500, '', {}), messages)).toEqual({ message: messages.fallback, forbidden: false });
  });

  it('uses the fallback for network or unknown errors', () => {
    expect(describeLoadFailure(new TypeError('fetch failed'), messages)).toEqual({ message: messages.fallback, forbidden: false });
  });
});
