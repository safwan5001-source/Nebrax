import { describe, expect, it } from 'vitest';
import { createIdempotencyGuard, signatureOf } from './idempotency';

describe('idempotency guard', () => {
  it('reuses the key for an identical retry and matches the server key pattern', () => {
    const guard = createIdempotencyGuard();
    const a = guard.keyFor({ amount: 100, partner_id: 'p' });
    const b = guard.keyFor({ partner_id: 'p', amount: 100 });
    expect(b).toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9._:-]{8,255}$/);
  });

  it('issues a new key when the payload changed', () => {
    const guard = createIdempotencyGuard();
    const a = guard.keyFor({ amount: 100 });
    expect(guard.keyFor({ amount: 200 })).not.toBe(a);
  });

  it('starts a new operation after a success', () => {
    const guard = createIdempotencyGuard();
    const a = guard.keyFor({ amount: 100 });
    guard.done();
    expect(guard.keyFor({ amount: 100 })).not.toBe(a);
  });

  it('treats form data with the same fields and files as identical', () => {
    const build = () => {
      const f = new FormData();
      f.append('amount', '100');
      f.append('attachments[]', new File(['x'], 'a.pdf', { lastModified: 1 }));
      return f;
    };
    expect(signatureOf(build())).toBe(signatureOf(build()));
    const guard = createIdempotencyGuard();
    expect(guard.keyFor(build())).toBe(guard.keyFor(build()));
  });
});
