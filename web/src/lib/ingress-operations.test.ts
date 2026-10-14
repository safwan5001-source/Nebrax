// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IngressRequestInvalid, IngressResponseUnreadable, IngressUnavailableInDemo, createIngressPoint, disableIngress, reassignIngressOperator, rotateIngressSecret } from './ingress-operations';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const SECRET = 'dsec_SENTINEL_unit_secret_0123456789';

beforeEach(() => { api.mockReset(); localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('rotateIngressSecret', () => {
  it('POSTs the existing rotate route once and returns only the new value', async () => {
    api.mockResolvedValue({ data: { id: 'ing-1', status: 'configured', secret_version: 4 }, secret: SECRET });
    await expect(rotateIngressSecret('ing-1')).resolves.toEqual({ value: SECRET });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/delivery-connectors/ing-1/rotate-secret', { method: 'POST' });
  });

  it.each([
    ['no secret field', { data: {} }],
    ['empty secret', { secret: '' }],
    ['non-string secret', { secret: 42 }],
    ['whitespace inside', { secret: 'a b' }],
    ['oversized', { secret: 'x'.repeat(513) }],
    ['null payload', null],
  ])('treats %s as an unreadable success (no status, so an unknown outcome) and carries no payload in the error', async (_name, payload) => {
    api.mockResolvedValue(payload);
    const error = await rotateIngressSecret('ing-1').catch((e) => e);
    expect(error).toBeInstanceOf(IngressResponseUnreadable);
    expect((error as { status?: unknown }).status).toBeUndefined();
    expect(JSON.stringify([error.message, error.stack ?? ''])).not.toContain('xxxx');
  });

  it('rethrows transport and HTTP errors unchanged (classification happens elsewhere) and never includes a secret', async () => {
    const failure = Object.assign(new Error('boom'), { status: 409, body: { error_code: 'connector_unavailable' } });
    api.mockRejectedValue(failure);
    await expect(rotateIngressSecret('ing-1')).rejects.toBe(failure);
  });

  it('refuses an id that is not a plain identifier and sends nothing (no path injection)', async () => {
    for (const bad of ['', '../x', 'a/b', 'a?b=1', 'a b', 'x'.repeat(65)]) {
      await expect(rotateIngressSecret(bad)).rejects.toBeInstanceOf(IngressResponseUnreadable);
    }
    expect(api).not.toHaveBeenCalled();
  });

  it('in demo mode sends nothing and invents no secret', async () => {
    localStorage.setItem('demo', 'true');
    await expect(rotateIngressSecret('ing-1')).rejects.toBeInstanceOf(IngressUnavailableInDemo);
    await expect(disableIngress('ing-1')).rejects.toBeInstanceOf(IngressUnavailableInDemo);
    expect(api).not.toHaveBeenCalled();
  });
});

describe('createIngressPoint', () => {
  it('POSTs the existing create route once with exactly the three contract fields, and returns only the secret', async () => {
    api.mockResolvedValue({ data: { id: 'ing-9', status: 'configured', secret_version: 1 }, secret: SECRET });
    await expect(createIngressPoint({ profileId: 'prof-1', storeId: 'Store-100', branchId: 'br-2' })).resolves.toEqual({ value: SECRET });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/delivery-connectors', { method: 'POST', body: { delivery_platform_profile_id: 'prof-1', external_store_id: 'Store-100', branch_id: 'br-2' } });
  });

  it('omits branch_id when there is no branch', async () => {
    api.mockResolvedValue({ secret: SECRET });
    await createIngressPoint({ profileId: 'prof-1', storeId: 'Store-100', branchId: null });
    expect(api.mock.calls[0][1].body).toEqual({ delivery_platform_profile_id: 'prof-1', external_store_id: 'Store-100' });
  });

  it.each([
    ['no secret', { data: {} }],
    ['empty secret', { secret: '' }],
    ['whitespace in secret', { secret: 'a b' }],
    ['null', null],
  ])('treats a 2xx with %s as an unreadable success (an unknown outcome: no status, no payload in the error)', async (_name, payload) => {
    api.mockResolvedValue(payload);
    const error = await createIngressPoint({ profileId: 'prof-1', storeId: 'S', branchId: null }).catch((e) => e);
    expect(error).toBeInstanceOf(IngressResponseUnreadable);
    expect((error as { status?: unknown }).status).toBeUndefined();
  });

  it('rethrows transport and HTTP errors unchanged', async () => {
    const failure = Object.assign(new Error('boom'), { status: 409, body: { error_code: 'mapping_ambiguous' } });
    api.mockRejectedValue(failure);
    await expect(createIngressPoint({ profileId: 'prof-1', storeId: 'S', branchId: null })).rejects.toBe(failure);
  });

  it('refuses an input that cannot be sent (a definite failure, nothing sent) and sends nothing', async () => {
    for (const input of [
      { profileId: '', storeId: 'S', branchId: null },
      { profileId: '../x', storeId: 'S', branchId: null },
      { profileId: 'p', storeId: 'S', branchId: 'a/b' },
      { profileId: 'p', storeId: '', branchId: null },
    ]) {
      await expect(createIngressPoint(input)).rejects.toBeInstanceOf(IngressRequestInvalid);
    }
    expect(api).not.toHaveBeenCalled();
  });

  it('in demo mode sends nothing and invents no secret', async () => {
    localStorage.setItem('demo', 'true');
    await expect(createIngressPoint({ profileId: 'p', storeId: 'S', branchId: null })).rejects.toBeInstanceOf(IngressUnavailableInDemo);
    expect(api).not.toHaveBeenCalled();
  });
});

describe('disableIngress', () => {
  it('POSTs the existing disable route and succeeds only when the server reports disabled', async () => {
    api.mockResolvedValue({ data: { id: 'ing-1', status: 'disabled' } });
    await expect(disableIngress('ing-1')).resolves.toBeUndefined();
    expect(api).toHaveBeenCalledWith('/delivery-connectors/ing-1/disable', { method: 'POST' });
  });

  it.each([
    ['still configured', { data: { status: 'configured' } }],
    ['no data', {}],
    ['null', null],
  ])('treats a 2xx that is %s as an unknown outcome', async (_name, payload) => {
    api.mockResolvedValue(payload);
    await expect(disableIngress('ing-1')).rejects.toBeInstanceOf(IngressResponseUnreadable);
  });
});

describe('reassignIngressOperator', () => {
  it('POSTs the existing reassign route once with exactly { user_id } and resolves on a data object', async () => {
    api.mockResolvedValue({ data: { id: 'ing-1', status: 'configured', operated_by: 'u-9' } });
    await expect(reassignIngressOperator('ing-1', 'u-9')).resolves.toBeUndefined();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/delivery-connectors/ing-1/reassign', { method: 'POST', body: { user_id: 'u-9' } });
  });

  it.each([
    ['no data', {}], ['null payload', null], ['data null', { data: null }], ['data list', { data: [] }], ['data string', { data: 'ok' }],
  ])('treats %s as an unreadable success (no status ⇒ unknown outcome)', async (_name, payload) => {
    api.mockResolvedValue(payload);
    const error = await reassignIngressOperator('ing-1', 'u-9').catch((e) => e);
    expect(error).toBeInstanceOf(IngressResponseUnreadable);
    expect((error as { status?: unknown }).status).toBeUndefined();
  });

  it('rejects ids that are not plain identifiers before any request (client check; the server is final)', async () => {
    for (const bad of ['', '../x', 'a/b', 'a?b=1', 'a b', 'x'.repeat(65)]) {
      await expect(reassignIngressOperator(bad, 'u-9')).rejects.toBeInstanceOf(IngressRequestInvalid);
      await expect(reassignIngressOperator('ing-1', bad)).rejects.toBeInstanceOf(IngressRequestInvalid);
    }
    expect(api).not.toHaveBeenCalled();
  });

  it('rethrows HTTP and transport errors unchanged and never repeats the request', async () => {
    const failure = Object.assign(new Error('boom'), { status: 422, body: { error_code: 'operator_ineligible' } });
    api.mockRejectedValue(failure);
    await expect(reassignIngressOperator('ing-1', 'u-9')).rejects.toBe(failure);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('in demo mode sends nothing', async () => {
    localStorage.setItem('demo', 'true');
    await expect(reassignIngressOperator('ing-1', 'u-9')).rejects.toBeInstanceOf(IngressUnavailableInDemo);
    expect(api).not.toHaveBeenCalled();
  });
});
