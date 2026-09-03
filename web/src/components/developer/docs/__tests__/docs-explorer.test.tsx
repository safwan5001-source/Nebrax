// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { DocsExplorer } from '@/components/developer/docs/docs-explorer';
import { OPENAPI_MODEL } from '@/modules/developer/docs/openapi-model.generated';

afterEach(cleanup);

const selectOperation = (id: string) => {
  const select = screen.getByLabelText(/select an operation|اختر عمليّة/i) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: id } });
};

describe('OpenAPI-driven documentation explorer', () => {
  it('renders every contract tag and operation in the navigation', () => {
    renderIntl(<DocsExplorer />, 'en');
    for (const tag of OPENAPI_MODEL.tags) {
      expect(screen.getAllByText(tag.name).length).toBeGreaterThan(0);
    }
    // منتقي العمليّات يحمل كل الـ16 عمليّة
    const options = document.querySelectorAll('option');
    expect(options.length).toBe(OPENAPI_MODEL.tags.flatMap((t) => t.operations).length);
  });

  it('shows the selected operation method, path, required scope and idempotency for a write', () => {
    renderIntl(<DocsExplorer />, 'en');
    selectOperation('createInvoiceDraft');
    const body = document.body;
    expect(within(body).getAllByText('POST').length).toBeGreaterThan(0);
    expect(within(body).getAllByText('/invoices').length).toBeGreaterThan(0);
    expect(within(body).getAllByText('invoices:write').length).toBeGreaterThan(0);
    // فرض idempotency ظاهر للكتابة
    expect(body.textContent).toMatch(/Idempotency-Key/);
    // حقل من المخطّط الحقيقي في جدول الحقول
    expect(within(body).getAllByText('partner_id').length).toBeGreaterThan(0);
  });

  it('derives the cURL example from the contract with the auth header and no internal route', () => {
    renderIntl(<DocsExplorer />, 'en');
    selectOperation('createInvoiceDraft');
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/curl -X POST/);
    expect(text).toContain('Authorization: Bearer $AWJ_API_KEY');
    expect(text).not.toContain('/api/developer'); // لا مسارات داخلية في التوثيق العام
  });

  it('renders code in LTR direction even in an Arabic UI', () => {
    const { container } = renderIntl(<DocsExplorer />, 'ar');
    // كتلة الشيفرة LTR رغم واجهة RTL (§15)
    const ltrPre = container.querySelector('pre[dir="ltr"]');
    expect(ltrPre).toBeTruthy();
  });
});
