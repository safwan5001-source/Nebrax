export type CashDrawerStatus = 'opened' | 'unsupported' | 'not_configured' | 'bridge_unavailable' | 'printer_unavailable' | 'permission_denied' | 'failed' | 'pending';

export interface CashDrawerBridgeResult {
  ok?: boolean;
  status: CashDrawerStatus;
  error_code: string | null;
  device?: string;
  request_id?: string;
  receipt?: string;
}

export interface CashDrawerAction extends CashDrawerBridgeResult {
  action_id?: string;
  bridge?: {
    url: string;
    request: {
      version: number;
      action_id: string;
      device_id: string;
      expires_at: number;
      nonce: string;
      signature: string;
    };
  };
}

/**
 * لا يرسل إلا عقد open الثابت إلى localhost. لا توجد دالة raw-command ولا يقبل
 * النجاح إلا بعد أن يؤكده API من HMAC الذي أنشأه الجسر المقترن.
 */
export async function executeCashDrawerAction(
  action: CashDrawerAction,
  complete: (actionId: string, result: CashDrawerBridgeResult) => Promise<CashDrawerBridgeResult>,
  unavailable: (actionId: string) => Promise<CashDrawerBridgeResult>,
): Promise<CashDrawerBridgeResult> {
  if (action.status !== 'pending' || !action.action_id || !action.bridge) return action;

  try {
    const response = await fetch(action.bridge.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.bridge.request),
    });
    const result = await response.json() as CashDrawerBridgeResult;
    if (!result || typeof result.status !== 'string') return unavailable(action.action_id);
    return complete(action.action_id, result);
  } catch {
    return unavailable(action.action_id);
  }
}
