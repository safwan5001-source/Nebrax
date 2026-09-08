// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AwjGlobalSearch } from './awj-global-search';

const apiMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: apiMock };
});

const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');

function setUser(permissions: string[]) {
  localStorage.setItem(
    'user',
    JSON.stringify({ id: 'u1', name: 'Test', email: 't@t.com', role: 'staff', tenant_id: 't1', permissions })
  );
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  pushMock.mockReset();
  localStorage.clear();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

/** يقدّم زمن الـdebounce ويُصرّف كل الوعود المعلَّقة (نداء API + تحديث الحالة). */
async function settleDebounce(ms = 350) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('AwjGlobalSearch', () => {
  it('only offers search types the user actually has permission for', () => {
    setUser(['invoices.view', 'products.view']);
    render(<AwjGlobalSearch />);

    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    const options = screen.getAllByRole('option').map((el) => el.textContent);

    expect(options).toContain('type_invoices');
    expect(options).toContain('type_products');
    expect(options).not.toContain('type_purchases');
    expect(options).not.toContain('type_journal_entries');
    expect(options).not.toContain('type_customers');
    expect(options).not.toContain('type_suppliers');
  });

  it('offers customers and suppliers when the user holds partners.view', () => {
    setUser(['partners.view']);
    render(<AwjGlobalSearch />);

    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    const options = screen.getAllByRole('option').map((el) => el.textContent);

    expect(options).toContain('type_customers');
    expect(options).toContain('type_suppliers');
  });

  it('hides customers and suppliers for a user without partners.view', () => {
    setUser(['invoices.view']);
    render(<AwjGlobalSearch />);

    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    const options = screen.getAllByRole('option').map((el) => el.textContent);

    expect(options).not.toContain('type_customers');
    expect(options).not.toContain('type_suppliers');
  });

  /**
   * إصلاح انكشاف عن `overflow-hidden` على شريط البحث كان يقصّ القائمة بصرياً
   * (تبقى في الـDOM لكن لا تُرسَم، فتذهب لمسة/نقرة المستخدم لما تحتها) — هذه
   * المجموعة تثبت التفاعل الفعلي (فتح/إغلاق/تبديل) لا مجرد وجود النصوص، لأن
   * jsdom لا يحاكي القصّ البصري أصلاً ولن يكشف عطلاً من هذا النوع بمفرده؛
   * التحقق البصري الحقيقي (Playwright) موثَّق في تقرير التنفيذ المرفق.
   */
  describe('category selector — open/close interaction', () => {
    it('shows no listbox until the trigger is clicked, and opens one on click', () => {
      setUser(['invoices.view']);
      render(<AwjGlobalSearch />);

      expect(screen.queryByRole('listbox')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));

      expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('closes the listbox after a category is selected', () => {
      setUser(['invoices.view']);
      render(<AwjGlobalSearch />);

      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      expect(screen.getByRole('listbox')).toBeTruthy();

      fireEvent.click(screen.getByRole('option', { name: 'type_invoices' }));

      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes the listbox when clicking outside the component', () => {
      setUser(['invoices.view']);
      render(<AwjGlobalSearch />);

      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      expect(screen.getByRole('listbox')).toBeTruthy();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes the listbox when the search input is focused (no overlapping panels)', () => {
      setUser(['invoices.view']);
      render(<AwjGlobalSearch />);

      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      expect(screen.getByRole('listbox')).toBeTruthy();

      fireEvent.focus(screen.getByPlaceholderText('placeholder_all'));

      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes the results panel when the type selector is opened (no overlapping panels)', async () => {
      setUser(['invoices.view']);
      apiMock.mockResolvedValue({ data: [{ id: 'inv-1', number: 'INV-001' }] });
      render(<AwjGlobalSearch />);

      fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'INV' } });
      await settleDebounce();
      expect(screen.getByText('INV-001')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));

      expect(screen.getByRole('listbox')).toBeTruthy();
      expect(screen.queryByText('INV-001')).toBeNull();
    });

    it('closes the listbox on Escape', () => {
      setUser(['invoices.view']);
      render(<AwjGlobalSearch />);

      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      expect(screen.getByRole('listbox')).toBeTruthy();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  it('selecting a category updates the visible label and scopes the next search to it', async () => {
    setUser(['invoices.view', 'products.view']);
    apiMock.mockResolvedValue({ data: [{ id: 'inv-1', number: 'INV-777' }] });

    render(<AwjGlobalSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    fireEvent.click(screen.getByRole('option', { name: 'type_invoices' }));

    // التسمية الظاهرة مكان «الكل» أصبحت الفئة المختارة، والـplaceholder تغيّر معها.
    expect(screen.getByRole('button', { name: 'type_selector_label' }).textContent).toContain('type_invoices');
    expect(screen.getByPlaceholderText('placeholder_invoices')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('placeholder_invoices'), { target: { value: 'INV' } });
    await settleDebounce();

    // فئة واحدة فقط استُدعيت رغم توفّر صلاحية على فئتين — الاختيار فعليّ لا افتراضي.
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/invoices?search=INV'));
  });

  it('returning to "all" after picking a single category restores multi-category search', async () => {
    setUser(['invoices.view', 'products.view']);
    apiMock.mockImplementation((url: string) =>
      url.startsWith('/invoices')
        ? Promise.resolve({ data: [{ id: 'inv-1', number: 'INV-1' }] })
        : Promise.resolve({ data: [{ id: 'p-1', name: 'Widget' }] })
    );

    render(<AwjGlobalSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    fireEvent.click(screen.getByRole('option', { name: 'type_invoices' }));
    fireEvent.change(screen.getByPlaceholderText('placeholder_invoices'), { target: { value: 'xx' } });
    await settleDebounce();
    expect(apiMock).toHaveBeenCalledTimes(1);

    apiMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    fireEvent.click(screen.getByRole('option', { name: 'type_all' }));
    expect(screen.getByPlaceholderText('placeholder_all')).toBeTruthy();

    // قيمة مختلفة عن 'xx' السابقة عمداً: React لا يُطلق onChange حين تُعاد نفس
    // القيمة حرفياً على عنصر إدخال متحكَّم فيه (خاصّية اختبار معروفة في jsdom)،
    // وهذا لا يمثّل تفاعلاً حقيقياً على متصفّح فعلي بحال إعادة الكتابة.
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'yy' } });
    await settleDebounce();

    // كلتا الفئتين المسموحتين استُدعيتا — العودة إلى «الكل» ليست عالقة على آخر اختيار.
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('INV-1')).toBeTruthy();
    expect(screen.getByText('Widget')).toBeTruthy();
  });

  it('does not query the backend before 2 characters are typed', async () => {
    setUser(['invoices.view']);
    render(<AwjGlobalSearch />);

    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'a' } });
    await settleDebounce(500);

    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText('min_chars')).toBeTruthy();
  });

  it('debounces the query, searches only allowed categories, and renders context-rich results', async () => {
    setUser(['invoices.view']);
    apiMock.mockResolvedValue({
      data: [
        { id: 'inv-1', number: 'INV-001', partner: { name: 'Acme' }, invoice_date: '2026-01-05', total: '150.00' },
      ],
    });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'INV' } });
    await settleDebounce();

    // فئة واحدة فقط مسموحة (فواتير) — نداء واحد لا أربعة.
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/invoices?search=INV'));
    expect(screen.getByText('INV-001')).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();

    fireEvent.click(screen.getByText('INV-001'));
    expect(pushMock).toHaveBeenCalledWith('/invoices/inv-1');
  });

  it('queries customers with a type=customer filter and an unbroken search param', async () => {
    setUser(['partners.view']);
    apiMock.mockResolvedValue({
      data: [
        { id: 'p-1', name: 'مؤسسة الخليج للتجارة', code: 'C-001', vat_number: '311111111100003', mobile: '0551234567' },
      ],
    });

    render(<AwjGlobalSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    fireEvent.click(screen.getByRole('option', { name: 'type_customers' }));
    fireEvent.change(screen.getByPlaceholderText('placeholder_customers'), { target: { value: 'خليج' } });
    await settleDebounce();

    expect(apiMock).toHaveBeenCalledTimes(1);
    const url = apiMock.mock.calls[0][0] as string;
    expect(url).toContain('/partners?type=customer');
    expect(url).toContain('&search=');
    expect(url).not.toMatch(/\?.*\?/); // لا علامة سؤال مكرّرة (رابط غير مكسور)
    expect(url).toContain(`search=${encodeURIComponent('خليج')}`);

    expect(screen.getByText('مؤسسة الخليج للتجارة')).toBeTruthy();
    expect(screen.getByText(/C-001/)).toBeTruthy();

    fireEvent.click(screen.getByText('مؤسسة الخليج للتجارة'));
    expect(pushMock).toHaveBeenCalledWith('/partners/p-1');
  });

  it('queries suppliers with a type=supplier filter', async () => {
    setUser(['partners.view']);
    apiMock.mockResolvedValue({
      data: [{ id: 's-1', name: 'شركة الجزيرة للتوريدات', code: 'S-001' }],
    });

    render(<AwjGlobalSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
    fireEvent.click(screen.getByRole('option', { name: 'type_suppliers' }));
    fireEvent.change(screen.getByPlaceholderText('placeholder_suppliers'), { target: { value: 'جزيرة' } });
    await settleDebounce();

    expect(apiMock).toHaveBeenCalledTimes(1);
    const url = apiMock.mock.calls[0][0] as string;
    expect(url).toContain('/partners?type=supplier');
    expect(url).toContain('&search=');

    fireEvent.click(screen.getByText('شركة الجزيرة للتوريدات'));
    expect(pushMock).toHaveBeenCalledWith('/partners/s-1');
  });

  it('includes customers and suppliers in an "all" search without dropping the older categories', async () => {
    setUser(['invoices.view', 'products.view', 'partners.view']);
    apiMock.mockImplementation((url: string) => {
      if (url.startsWith('/partners?type=customer')) {
        return Promise.resolve({ data: [{ id: 'c-1', name: 'عميل معاينة' }] });
      }
      if (url.startsWith('/partners?type=supplier')) {
        return Promise.resolve({ data: [{ id: 's-1', name: 'مورّد معاينة' }] });
      }
      if (url.startsWith('/invoices')) {
        return Promise.resolve({ data: [{ id: 'inv-1', number: 'INV-001' }] });
      }
      return Promise.resolve({ data: [{ id: 'p-1', name: 'منتج معاينة' }] });
    });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'معاينة' } });
    await settleDebounce();

    // كل الفئات المسموحة الأربع القديمة + العملاء والموردون — لا نداء منها يُسقَط.
    expect(apiMock).toHaveBeenCalledTimes(4);
    expect(screen.getByText('عميل معاينة')).toBeTruthy();
    expect(screen.getByText('مورّد معاينة')).toBeTruthy();
    expect(screen.getByText('INV-001')).toBeTruthy();
    expect(screen.getByText('منتج معاينة')).toBeTruthy();
  });

  it('shows "no results" when the search comes back empty', async () => {
    setUser(['invoices.view']);
    apiMock.mockResolvedValue({ data: [] });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'zzz' } });
    await settleDebounce();

    expect(screen.getByText('no_results')).toBeTruthy();
  });

  it('does not let a 403 from one category break the rest of an "all" search', async () => {
    setUser(['invoices.view', 'products.view']);
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/invoices')) {
        return Promise.reject(new ApiError(403, 'forbidden', {}));
      }
      return Promise.resolve({ data: [{ id: 'p-1', name: 'Widget', sku: 'W-1' }] });
    });

    render(<AwjGlobalSearch />);
    fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'wid' } });
    await settleDebounce();

    expect(screen.getByText('Widget')).toBeTruthy();
  });

  /**
   * انكشاف حقيقي على بيانات حقيقية بعد #692/#697: العملاء والموردون كانا
   * يعملان بينما الفواتير/المشتريات/المنتجات/القيود لا تعيد نتائج إطلاقاً —
   * لا لأن استعلامها خاطئ، بل لأن `/invoices`، `/purchases`، `/products`،
   * و`/journal-entries` تفرض `per_page >= 10` (قيد قائم في تلك النقاط من قبل)
   * بينما القيمتان القديمتان هنا (٤ و٨) كانتا تحته فيرفضهما الخادم بـ٤٢٢،
   * ومعالجة الأخطاء الحالية تُسقط أي خطأ غير ٤٠٣ بصمت كـ«لا نتائج». هذه
   * المجموعة تستعمل بنى استجابة واقعية لكل نقطة (لا شكلاً موحّداً مصطنعاً)
   * لإثبات أن كل فئة تُستخرَج وتُعرض فعلياً، لا فقط أن apiMock استُدعي.
   */
  describe('core categories return real results again (per_page floor fix)', () => {
    it('shows a matching sales invoice — real InvoiceResource shape (no eager-loaded partner)', async () => {
      setUser(['invoices.view']);
      apiMock.mockResolvedValue({
        data: [
          {
            id: 'inv-1', number: 'INV-2026-00039', partner_id: 'p-1',
            payment_type: 'cash', status: 'draft', payment_status: 'unpaid',
            invoice_date: '2026-06-24', total: '5750.00',
          },
        ],
        links: { first: 'x', last: 'x', prev: null, next: null },
        meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
      });

      render(<AwjGlobalSearch />);
      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      fireEvent.click(screen.getByRole('option', { name: 'type_invoices' }));
      fireEvent.change(screen.getByPlaceholderText('placeholder_invoices'), { target: { value: '00039' } });
      await settleDebounce();

      const url = apiMock.mock.calls[0][0] as string;
      expect(url).toContain('/invoices?search=00039');
      expect(url).toContain('per_page=20'); // فئة واحدة مختارة — لا القيمة القديمة (8) التي كان الخادم يرفضها
      expect(screen.getByText('INV-2026-00039')).toBeTruthy();

      fireEvent.click(screen.getByText('INV-2026-00039'));
      expect(pushMock).toHaveBeenCalledWith('/invoices/inv-1');
    });

    it('shows a matching purchase — real PurchaseResource shape', async () => {
      setUser(['purchases.view']);
      apiMock.mockResolvedValue({
        data: [{ id: 'pur-1', number: 'PUR-2026-0042', partner_id: 's-1', purchase_date: '2026-06-20', total: '1150.00' }],
        meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
      });

      render(<AwjGlobalSearch />);
      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      fireEvent.click(screen.getByRole('option', { name: 'type_purchases' }));
      fireEvent.change(screen.getByPlaceholderText('placeholder_purchases'), { target: { value: '0042' } });
      await settleDebounce();

      const url = apiMock.mock.calls[0][0] as string;
      expect(url).toContain('/purchases?search=0042');
      expect(url).toContain('per_page=20');
      expect(screen.getByText('PUR-2026-0042')).toBeTruthy();
    });

    it('shows a matching product — real ProductResource shape', async () => {
      setUser(['products.view']);
      apiMock.mockResolvedValue({
        data: [{ id: 'prod-1', sku: 'PUMP-XJ500', barcode: '6291000112233', name: 'مضخة وقود ديزل XJ-500', type: 'good', sale_price: '100.00' }],
      });

      render(<AwjGlobalSearch />);
      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      fireEvent.click(screen.getByRole('option', { name: 'type_products' }));
      fireEvent.change(screen.getByPlaceholderText('placeholder_products'), { target: { value: 'XJ500' } });
      await settleDebounce();

      const url = apiMock.mock.calls[0][0] as string;
      expect(url).toContain('/products?search=XJ500');
      expect(url).toContain('per_page=20');
      expect(screen.getByText('مضخة وقود ديزل XJ-500')).toBeTruthy();
    });

    it('shows a matching journal entry — real mapEntry() shape (data + meta + facets)', async () => {
      setUser(['accounts.view']);
      apiMock.mockResolvedValue({
        data: [{ id: 'je-1', number: 'JE-2026-0003', entry_date: '2026-06-24', description: 'قيد فاتورة', status: 'posted', total: '1150.00' }],
        meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
        facets: { source_types: [] },
      });

      render(<AwjGlobalSearch />);
      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      fireEvent.click(screen.getByRole('option', { name: 'type_journal_entries' }));
      fireEvent.change(screen.getByPlaceholderText('placeholder_journal_entries'), { target: { value: '0003' } });
      await settleDebounce();

      const url = apiMock.mock.calls[0][0] as string;
      expect(url).toContain('/journal-entries?search=0003');
      expect(url).toContain('per_page=20');
      expect(screen.getByText('JE-2026-0003')).toBeTruthy();
    });

    it('an "all" search sends per_page=10 (satisfies every endpoint\'s floor) and shows results from all matching categories', async () => {
      setUser(['invoices.view', 'purchases.view', 'products.view', 'accounts.view']);
      apiMock.mockImplementation((url: string) => {
        if (url.startsWith('/invoices')) return Promise.resolve({ data: [{ id: 'inv-1', number: 'INV-1' }] });
        if (url.startsWith('/purchases')) return Promise.resolve({ data: [{ id: 'pur-1', number: 'PUR-1' }] });
        if (url.startsWith('/products')) return Promise.resolve({ data: [{ id: 'prod-1', name: 'Widget' }] });
        return Promise.resolve({ data: [{ id: 'je-1', number: 'JE-1' }] });
      });

      render(<AwjGlobalSearch />);
      fireEvent.change(screen.getByPlaceholderText('placeholder_all'), { target: { value: 'term' } });
      await settleDebounce();

      apiMock.mock.calls.forEach(([url]) => {
        expect(url as string).toContain('per_page=10');
      });
      expect(screen.getByText('INV-1')).toBeTruthy();
      expect(screen.getByText('PUR-1')).toBeTruthy();
      expect(screen.getByText('Widget')).toBeTruthy();
      expect(screen.getByText('JE-1')).toBeTruthy();
    });

    it('does not regress customers/suppliers while fixing the core four', async () => {
      setUser(['partners.view']);
      apiMock.mockResolvedValue({ data: [{ id: 'p-1', name: 'مؤسسة الخليج للتجارة', code: 'C-001' }] });

      render(<AwjGlobalSearch />);
      fireEvent.click(screen.getByRole('button', { name: 'type_selector_label' }));
      fireEvent.click(screen.getByRole('option', { name: 'type_customers' }));
      fireEvent.change(screen.getByPlaceholderText('placeholder_customers'), { target: { value: 'خليج' } });
      await settleDebounce();

      const url = apiMock.mock.calls[0][0] as string;
      expect(url).toContain('/partners?type=customer');
      expect(url).toContain('per_page=20');
      expect(screen.getByText('مؤسسة الخليج للتجارة')).toBeTruthy();
    });
  });
});
