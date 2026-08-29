/**
 * تسميات قواعد الكشف — طبقة عرض فقط.
 * المفاتيح الداخلية (rule_key) تبقى كما هي في الـ API والمحرّك.
 */

/** مفاتيح القواعد المعروفة في كتالوج loss-prevention. */
export const KNOWN_RULE_KEYS = [
  'item_removal_rate',
  'quantity_reduction_rate',
  'cart_cancellation_rate',
  'price_override_rate',
  'discount_activity_rate',
  'payment_failure_rate',
  'aborted_checkout_rate',
  'manual_drawer_open_rate',
  'cash_movement_frequency',
  'closing_variance_frequency',
  'closing_variance_magnitude',
  'recount_usage_rate',
  'variance_settlement_frequency',
  'refund_frequency',
  'refund_amount_rate',
  'approval_required_rate',
  'performer_approver_pair_concentration',
  'approver_concentration',
  'override_approval_rate',
  'near_close_concentration',
  'repeated_hold_discard',
  'repeated_cancel_before_checkout',
  'cross_cashier_refund',
  'refund_shortly_after_sale',
  'manual_drawer_without_transaction_proximity',
  'override_then_cancel',
  'approval_replay',
  'outside_operating_hours',
] as const;

export type KnownRuleKey = (typeof KNOWN_RULE_KEYS)[number];

export function isKnownRuleKey(key: string): key is KnownRuleKey {
  return (KNOWN_RULE_KEYS as readonly string[]).includes(key);
}

/**
 * يحلّ التسمية البشرية عبر دالة ترجمة، ويسقط على المفتاح الخام للقيم المجهولة.
 * لا يخمن معنى مفتاح غير معروف.
 */
export function resolveRuleLabel(ruleKey: string, translate: (key: string) => string): string {
  if (!isKnownRuleKey(ruleKey)) return ruleKey;
  const label = translate(ruleKey);
  return label || ruleKey;
}
