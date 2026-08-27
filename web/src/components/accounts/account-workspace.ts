import type { AccountType, ManagedAccount } from '@/components/accounts/account-dialog';

export interface AccountPathItem {
  id: string;
  code: string;
  name: string;
}

export interface WorkspaceAccount extends ManagedAccount {
  direct_balance: string;
  aggregated_balance: string;
  path: AccountPathItem[];
}

export interface AccountTreeNode extends WorkspaceAccount {
  children: AccountTreeNode[];
}

export interface AccountTree {
  roots: AccountTreeNode[];
  byId: Map<string, AccountTreeNode>;
}

const byCode = (left: WorkspaceAccount, right: WorkspaceAccount) =>
  left.code.localeCompare(right.code, undefined, { numeric: true });

/**
 * يبني غابة آمنة من قائمة API المسطحة. الحساب ذو الأب المفقود أو الدورة
 * القديمة لا يختفي؛ يظهر كجذر قابل للمراجعة بدلاً من إسقاط بيانات العميل.
 */
export function buildAccountTree(accounts: WorkspaceAccount[]): AccountTree {
  const byId = new Map<string, AccountTreeNode>(
    accounts.map((account): [string, AccountTreeNode] => [account.id, { ...account, children: [] }]),
  );
  const roots: AccountTreeNode[] = [];

  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (!parent || parent.id === node.id) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const visited = new Set<string>();
  const activePath = new Set<string>();
  const verifiedRoots: AccountTreeNode[] = [];

  const visit = (node: AccountTreeNode) => {
    if (activePath.has(node.id) || visited.has(node.id)) return;
    visited.add(node.id);
    activePath.add(node.id);
    node.children.sort(byCode);
    for (const child of node.children) visit(child);
    activePath.delete(node.id);
  };

  for (const root of roots.sort(byCode)) {
    if (visited.has(root.id)) continue;
    verifiedRoots.push(root);
    visit(root);
  }
  for (const node of [...byId.values()].sort(byCode)) {
    if (visited.has(node.id)) continue;
    verifiedRoots.push(node);
    visit(node);
  }

  return { roots: verifiedRoots, byId };
}

export function accountMatches(account: WorkspaceAccount, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return false;

  return [account.code, account.name, account.name_en ?? '']
    .some((value) => value.toLocaleLowerCase().includes(normalized));
}

/** تُرجع الحسابات المطابقة مع سياق المسار الجاهز للعرض. */
export function searchAccounts(accounts: WorkspaceAccount[], query: string): WorkspaceAccount[] {
  if (!query.trim()) return [];
  return accounts.filter((account) => accountMatches(account, query)).sort(byCode);
}

export function ancestorIds(account: Pick<WorkspaceAccount, 'path'>): string[] {
  return account.path.slice(0, -1).map((item) => item.id);
}

export function accountNormalBalance(type: AccountType): 'debit' | 'credit' {
  return ['asset', 'expense'].includes(type) ? 'debit' : 'credit';
}
