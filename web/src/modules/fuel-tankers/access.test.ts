import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { classifyError, fieldErrors, hasPermission, serverMessage, TANKER_MANAGE, TANKER_VIEW } from './access';

describe('tanker permissions (display only; the server stays the authority)', () => {
  it('treats unloaded permissions as unknown, wildcard as full access, and exact keys only', () => {
    expect(hasPermission(null, TANKER_VIEW)).toBe(false);
    expect(hasPermission(['*'], TANKER_MANAGE)).toBe(true);
    expect(hasPermission([TANKER_VIEW], TANKER_VIEW)).toBe(true);
    expect(hasPermission([TANKER_VIEW], TANKER_MANAGE)).toBe(false);
    // المفتاح القديم لا يكفي (يوافق الخادم).
    expect(hasPermission(['fuel_stations.view', 'fuel_stations.manage'], TANKER_VIEW)).toBe(false);
  });
});

describe('server response classification', () => {
  const error = (status: number, body: unknown = {}) => new ApiError(status, 'msg', body);

  it('maps 404 on a list to the closed feature gate, and 404 on a record to not-found (never distinguishing foreign tenants)', () => {
    expect(classifyError(error(404), 'list')).toBe('gate_closed');
    expect(classifyError(error(404), 'record')).toBe('not_found');
    expect(classifyError(error(404), 'write')).toBe('not_found');
  });

  it('maps 403, 422 and everything else', () => {
    expect(classifyError(error(403), 'list')).toBe('forbidden');
    expect(classifyError(error(422), 'write')).toBe('validation');
    expect(classifyError(error(500), 'list')).toBe('other');
    expect(classifyError(new Error('network'), 'list')).toBe('other');
    expect(classifyError({ status: 403 }, 'record')).toBe('forbidden');
  });

  it('extracts the first validation message per field and ignores malformed bodies', () => {
    expect(fieldErrors(error(422, { errors: { code: ['مكرر', 'x'], plate_number: 'نص' } }))).toEqual({ code: 'مكرر', plate_number: 'نص' });
    expect(fieldErrors(error(422, { errors: { a: [1, 2] } }))).toEqual({});
    expect(fieldErrors(error(422, null))).toEqual({});
    expect(fieldErrors(new Error('x'))).toEqual({});
    expect(serverMessage(new ApiError(422, 'رسالة', {}))).toBe('رسالة');
    expect(serverMessage(new Error('x'))).toBeNull();
  });
});
