import { describe, expect, it } from 'vitest';
import { acceptAttr, blockKey, checkFiles, declaredMime, formatBytes, imageAcceptAttr, megabytes, reasonKey, SAFE_POLICY, toAttachment, toState } from './logic';

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type });
const policy = { ...SAFE_POLICY, max_bytes: 2 * 1024 * 1024, max_count: 3 };

describe('toAttachment / toState are defensive', () => {
  it('drops malformed rows and keeps safe defaults for missing fields', () => {
    expect(toAttachment(null)).toBeNull();
    expect(toAttachment({ id: 1 })).toBeNull();
    const row = toAttachment({ id: 'a', original_name: 'x.pdf', mime_type: 'application/pdf', size: 12, status: 'weird' });
    expect(row).toMatchObject({ id: 'a', kind: 'pdf', status: 'active', size: 12, uploaded_by_name: null });
  });
  it('falls back to the safe policy and denies by default when the server state is missing or corrupt', () => {
    const state = toState(undefined);
    expect(state.policy).toEqual(SAFE_POLICY);
    expect(state).toMatchObject({ can_add: false, can_remove: false, can_view_history: false, status: 'none', active_count: 0 });
    expect(toState({ policy: { max_bytes: -1, max_count: 'x', mime_types: [] }, status: 'bogus', can_add: 'yes' })).toMatchObject({ can_add: false, status: 'none', policy: { max_bytes: SAFE_POLICY.max_bytes, max_count: SAFE_POLICY.max_count } });
  });
  it('reads what the server announces without inventing permissions', () => {
    const state = toState({ policy: { required: true, mime_types: ['image/jpeg'], max_bytes: 5, max_count: 2, max_per_request: 1, after_close: 'deny', removal: 'never' }, active_count: 1, status: 'present', can_add: true, can_remove: true, add_blocked_reason: null, remove_blocked_reason: 'removal_disabled', can_view_history: true });
    expect(state.policy).toMatchObject({ required: true, mime_types: ['image/jpeg'], after_close: 'deny', removal: 'never' });
    expect(state).toMatchObject({ can_add: true, can_remove: true, can_view_history: true, remove_blocked_reason: 'removal_disabled' });
  });
});

describe('picking files', () => {
  it('accepts JPG, PNG and PDF within the policy', () => {
    const result = checkFiles([file('a.jpg', 'image/jpeg'), file('b.png', 'image/png'), file('c.pdf', 'application/pdf')], policy, 0);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toEqual([]);
  });
  it('rejects other types (GIF, executables, text) and empty files with a reason', () => {
    const result = checkFiles([file('a.gif', 'image/gif'), file('run.exe', 'application/x-msdownload'), file('n.txt', 'text/plain'), file('e.jpg', 'image/jpeg', 0)], policy, 0);
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(['type', 'type', 'type', 'empty']);
  });
  it('infers the type from the extension when the browser reports none (some mobile pickers)', () => {
    expect(declaredMime({ name: 'photo.JPG', type: '' })).toBe('image/jpeg');
    expect(declaredMime({ name: 'doc.pdf', type: 'application/octet-stream' })).toBe('application/pdf');
    expect(declaredMime({ name: 'noext', type: '' })).toBeNull();
    expect(checkFiles([file('photo.jpg', '')], policy, 0).accepted).toHaveLength(1);
  });
  it('enforces the size cap and the per-voucher count including what is already attached and queued', () => {
    expect(checkFiles([file('big.jpg', 'image/jpeg', 3 * 1024 * 1024)], policy, 0).rejected[0].reason).toBe('size');
    const full = checkFiles([file('1.jpg', 'image/jpeg'), file('2.jpg', 'image/jpeg'), file('3.jpg', 'image/jpeg')], policy, 2, 0);
    expect(full.accepted).toHaveLength(1);
    expect(full.rejected.map((r) => r.reason)).toEqual(['limit', 'limit']);
    expect(checkFiles([file('1.jpg', 'image/jpeg')], policy, 1, 2).rejected[0].reason).toBe('limit');
  });
  it('honours a narrowed type policy (images only) and exposes accept attributes from it', () => {
    const imagesOnly = { ...policy, mime_types: ['image/jpeg', 'image/png'] };
    expect(checkFiles([file('c.pdf', 'application/pdf')], imagesOnly, 0).rejected[0].reason).toBe('type');
    expect(acceptAttr(imagesOnly)).toBe('image/jpeg,image/png');
    expect(imageAcceptAttr(SAFE_POLICY)).toBe('image/jpeg,image/png');
    expect(acceptAttr(SAFE_POLICY)).toContain('application/pdf');
  });
});

describe('helpers', () => {
  it('formats sizes and megabytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(megabytes(10 * 1024 * 1024)).toBe(10);
  });
  it('maps only known server reasons and block codes (never invents)', () => {
    expect(reasonKey('attachment_too_large')).toBe('attachment_too_large');
    expect(reasonKey('something_else')).toBeNull();
    expect(reasonKey(undefined)).toBeNull();
    expect(blockKey('shift_closed')).toBe('shift_closed');
    expect(blockKey('weird')).toBeNull();
    expect(blockKey(null)).toBeNull();
  });
});
