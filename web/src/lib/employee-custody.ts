export type EmployeeCustodyStatus = 'draft' | 'posted';
export type EmployeeCustodyMethod = 'cash' | 'bank';

export interface CustodySettlement {
  id: string;
  branch_id?: string | null;
  number: string;
  employee_custody_id: string;
  settlement_type_id: string;
  settlement_type_name?: string | null;
  debit_account_id: string;
  debit_account_code?: string | null;
  debit_account_name?: string | null;
  settlement_date: string;
  amount: string;
  notes?: string | null;
  journal_entry_id: string;
  created_at?: string | null;
}

export interface EmployeeCustody {
  id: string;
  branch_id?: string | null;
  number: string;
  employee_id: string;
  employee_name?: string | null;
  employee_no?: string | null;
  custody_account_id: string;
  custody_account_code?: string | null;
  custody_account_name?: string | null;
  cash_account_id: string;
  cash_account_code?: string | null;
  cash_account_name?: string | null;
  method: EmployeeCustodyMethod;
  custody_date: string;
  due_date?: string | null;
  amount: string;
  settled_amount?: string;
  remaining_amount?: string;
  is_settled?: boolean;
  settlements_count?: number;
  settlements?: CustodySettlement[];
  status: EmployeeCustodyStatus;
  notes?: string | null;
  journal_entry_id?: string | null;
}

export interface CustodyEmployee {
  id: string;
  employee_no: string;
  name: string;
  is_active: boolean;
}

export interface CustodyCashBankAccount {
  id: string;
  account_id: string;
  account_code?: string | null;
  account_name?: string | null;
  type: EmployeeCustodyMethod;
  name: string;
  is_active: boolean;
  is_main: boolean;
}
