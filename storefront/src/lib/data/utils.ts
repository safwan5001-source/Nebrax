import {
  type PurchaseIssue,
  purchaseIssueFromError,
} from "@/lib/commerce/wholesale-buyer";

/**
 * Wraps a server action in a try/catch that returns a standardized
 * { success: true, ...data } | { success: false, error: string } result.
 */
export async function actionResult<T extends Record<string, unknown>>(
  fn: () => Promise<T>,
  fallbackMessage: string,
): Promise<
  | ({ success: true } & T)
  | { success: false; error: string; purchaseIssue?: PurchaseIssue }
> {
  try {
    const result = await fn();
    return { success: true, ...result };
  } catch (error) {
    const purchaseIssue = purchaseIssueFromError(error);
    return {
      success: false,
      error: error instanceof Error ? error.message : fallbackMessage,
      // Additive and only present for a wholesale refusal (401/403/unavailable): every other failure is byte-identical to before.
      ...(purchaseIssue ? { purchaseIssue } : {}),
    };
  }
}

/**
 * Wraps a server action in a try/catch that returns a fallback value on error.
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    return fallback;
  }
}
