import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCashDrawerAction, type CashDrawerAction } from '../cash-drawer-bridge';

const action: CashDrawerAction = {
  status: 'pending', error_code: null, action_id: 'action-1',
  bridge: {
    url: 'http://127.0.0.1:17463/v1/cash-drawer/open',
    request: { version: 1, action_id: 'action-1', device_id: 'device-1', expires_at: 1_900_000_000, nonce: 'nonce', signature: 'signature' },
  },
};

afterEach(() => vi.restoreAllMocks());

describe('executeCashDrawerAction', () => {
  it('confirms a bridge result with the API instead of treating a local HTTP response as final success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ status: 'opened', error_code: null, request_id: 'bridge-1', receipt: 'signed' }) }));
    const complete = vi.fn().mockResolvedValue({ status: 'opened', error_code: null });
    const unavailable = vi.fn();

    const result = await executeCashDrawerAction(action, complete, unavailable);

    expect(fetch).toHaveBeenCalledWith(action.bridge?.url, expect.objectContaining({ method: 'POST' }));
    expect(complete).toHaveBeenCalledWith('action-1', expect.objectContaining({ status: 'opened', receipt: 'signed' }));
    expect(unavailable).not.toHaveBeenCalled();
    expect(result.status).toBe('opened');
  });

  it('records bridge_unavailable when localhost cannot be reached and never returns opened', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unreachable')));
    const complete = vi.fn();
    const unavailable = vi.fn().mockResolvedValue({ status: 'bridge_unavailable', error_code: 'cash_drawer_bridge_unreachable' });

    const result = await executeCashDrawerAction(action, complete, unavailable);

    expect(complete).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith('action-1');
    expect(result.status).toBe('bridge_unavailable');
  });
});
