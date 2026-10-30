/**
 * Commercial rules of a wholesale channel — a static, read-only contract table taken from
 * `docs/audits/AWJ_H6_BATCH_I_COMMERCIAL_RULES_CONTRACT.md` (§A existing behaviour, §B proposals, §D owner decisions).
 * No rule here is configurable; each row names the owner decision that must land before it can become a setting.
 */
export const COMMERCIAL_RULES = [
  { key: 'moq', decisions: ['D-M1'] },
  { key: 'minAmount', decisions: ['D-M2'] },
  { key: 'vat', decisions: ['D-X1'] },
  { key: 'credit', decisions: ['D-P1', 'D-B3'] },
  { key: 'cod', decisions: ['D-P2'] },
  { key: 'suspension', decisions: ['D-S1'] },
  { key: 'link', decisions: ['D-B3'] },
  { key: 'ip', decisions: ['D-T1'] },
] as const;

export type CommercialRuleKey = (typeof COMMERCIAL_RULES)[number]['key'];
export type DecisionId = (typeof COMMERCIAL_RULES)[number]['decisions'][number];
