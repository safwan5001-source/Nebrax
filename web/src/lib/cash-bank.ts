export type CashBankType = 'cash' | 'bank';
export type PermissionScope = 'all' | 'role' | 'user' | 'branch';

export interface CashBankAccount {
  id: string;
  account_id: string;
  account_code?: string | null;
  account_name?: string | null;
  type: CashBankType;
  name: string;
  bank_name?: string | null;
  account_number?: string | null;
  currency: string;
  description?: string | null;
  is_active: boolean;
  is_main: boolean;
  balance: string;
  deposit_scope: PermissionScope;
  deposit_scope_subject?: string | null;
  withdraw_scope: PermissionScope;
  withdraw_scope_subject?: string | null;
}

export interface CashBankTransfer {
  id: string;
  number: string;
  source_cash_bank_account_id: string;
  source_name?: string | null;
  destination_cash_bank_account_id: string;
  destination_name?: string | null;
  amount: string;
  currency: string;
  transfer_date: string;
  reference?: string | null;
  notes?: string | null;
  journal_entry_id?: string | null;
}

export const PERMISSION_SCOPES: PermissionScope[] = ['all', 'role', 'user', 'branch'];
