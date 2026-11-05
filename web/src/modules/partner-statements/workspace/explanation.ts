/**
 * رموز تفسير المحرّك (`explanation.code`) والتحذيرات ومشاكل verify-set ⇒ مفاتيح ترجمة. **المفتاح هو الرمز لا النص**؛ رمز مجهول يسقط إلى نص عام آمن (`explanation.unknown`)
 * لا إلى نص الخادم الخام. المصدر: `PartnerStatementMatchingEngine` / `PartnerStatementMatchService::verifySet`. يحرس اختبارٌ وجود ترجمة ar/en لكل رمز.
 */

export const EXPLANATION_CODES = [
  'matched_by_our_reference',
  'matched_by_reference',
  'matched_by_amount_date_unique',
  'amount_differs',
  'date_differs',
  'direction_mismatch',
  'reversed_in_books',
  'ambiguous_multiple_documents_for_reference',
  'ambiguous_multiple_candidates',
  'unit_claimed_by_several_lines',
  'candidate_not_matchable',
  'candidate_reversal_incomplete',
  'no_candidate_in_books',
  // جهة الدفتر
  'reversed_pair_excluded',
  'reversal_chain_incomplete',
  'matched_to_statement_line',
  'linked_with_difference',
  'claimed_by_several_lines',
  'candidate_of_ambiguous_line',
  'no_statement_line',
] as const;

export const WARNING_CODES = ['kind_side_mismatch', 'unit_proposed_for_another_line'] as const;
export const VERIFY_PROBLEM_CODES = ['unit_not_in_candidates', 'unit_not_matchable'] as const;

const known = (list: readonly string[], code: string | null | undefined): string => (code && list.includes(code) ? code : 'unknown');

export const explanationKey = (code: string | null | undefined): string => known(EXPLANATION_CODES, code);
export const warningKey = (code: string | null | undefined): string => known(WARNING_CODES, code);
export const verifyProblemKey = (code: string | null | undefined): string => known(VERIFY_PROBLEM_CODES, code);

/** كتلة مُحاوِرة لمعاملات رقمية بسيطة فقط (أعداد/نصوص قصيرة) — لا نعرض كائنات الخادم الخام. */
export function safeParams(params: Record<string, unknown> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= 60) out[key] = value;
  }
  return out;
}
