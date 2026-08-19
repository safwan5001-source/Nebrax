export type EmployeeCustodyStatus = 'draft' | 'posted';
export type EmployeeCustodyMethod = 'cash' | 'bank';

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
