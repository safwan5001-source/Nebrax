import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PURCHASE_LIFECYCLE, SALES_INVOICE_LIFECYCLE, type LifecycleDefinition } from '../lifecycle';

// Guard: a lifecycle definition may only contain states the backend actually stores/accepts.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');

function backendStatusList(controller: string): string[] {
  const source = readFileSync(path.join(repoRoot, 'app/Http/Controllers/Api', controller), 'utf8');
  const match = source.match(/'status'\s*=>\s*\[[^\]]*'in:([a-z,]+)'/);
  if (!match) throw new Error(`no status validation list in ${controller}`);
  return match[1].split(',');
}

function documentStates(definition: LifecycleDefinition): string[] {
  return [...definition.document.sequence, ...definition.document.terminal];
}

describe('lifecycle definitions mirror stored backend values', () => {
  it('sales invoice states ⊆ InvoiceController status values', () => {
    const backend = backendStatusList('InvoiceController.php');
    for (const state of documentStates(SALES_INVOICE_LIFECYCLE)) expect(backend).toContain(state);
  });

  it('purchase states ⊆ PurchaseController status values', () => {
    const backend = backendStatusList('PurchaseController.php');
    for (const state of documentStates(PURCHASE_LIFECYCLE)) expect(backend).toContain(state);
  });

  it('never defines a prototype-only state (issued/approved/sent)', () => {
    for (const definition of [SALES_INVOICE_LIFECYCLE, PURCHASE_LIFECYCLE]) {
      for (const state of documentStates(definition)) expect(['issued', 'approved', 'sent']).not.toContain(state);
    }
  });

  it('payment states exist in the Invoice/Purchase models (unpaid default, partial, paid)', () => {
    for (const model of ['Invoice.php', 'Purchase.php']) {
      const source = readFileSync(path.join(repoRoot, 'app/Models', model), 'utf8');
      for (const state of ['unpaid', 'partial', 'paid']) expect(source).toContain(`'${state}'`);
    }
    expect(SALES_INVOICE_LIFECYCLE.payment).toEqual(['unpaid', 'partial', 'paid']);
  });
});
