import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import 'product_results.dart';
import 'runtime_status_views.dart';
import 'runtime_strings.dart';

/// S11 (الجيل 1.2.0) — منتجات تصنيف: شاشة أصلية تفتحها `openCategory` (نظير `ProductScreen` لـ`openProduct`).
///
/// معرّف التصنيف معامل تنقل لا بيانات. المنتجات من `GET products?category_id=` فالخادم هو السلطة الوحيدة على
/// ما يظهر (نشر القناة، عزل المستأجر)؛ العميل لا يُرشّح ولا يخمّن. عنوان التصنيف جلبٌ بأقصى جهد: فشله لا يمنع المنتجات.
class CategoryScreen extends StatefulWidget {
  final String categoryId;
  final CommerceClient client;
  final AppActionDispatcher dispatcher;
  final Locale locale;

  const CategoryScreen({
    super.key,
    required this.categoryId,
    required this.client,
    required this.dispatcher,
    required this.locale,
  });

  @override
  State<CategoryScreen> createState() => _CategoryScreenState();
}

class _CategoryScreenState extends State<CategoryScreen> {
  static const int _perPage = 24;

  final List<CommerceProductSummary> _items = [];
  CommercePaginationInfo? _pagination;
  String? _title;
  String? _error;
  bool _loading = true;
  bool _loadingMore = false;

  /// رقم تسلسلي: ردٌّ أقدم (تصنيف سابق/إعادة محاولة) أو بعد التفكيك لا يكتب فوق الأحدث.
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant CategoryScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.categoryId != widget.categoryId) _load();
  }

  @override
  void dispose() {
    _seq++; // يُبطل أي ردّ في الطريق.
    super.dispose();
  }

  String _messageOf(Object e) {
    if (e is CommerceApiException) return e.message;
    if (e is CommerceProtocolException) return e.message;
    return RuntimeStrings.of(widget.locale).connectionError;
  }

  Future<void> _load() async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _items.clear();
      _pagination = null;
      _title = null;
    });
    // العنوان: أقصى جهد، لا يُفشل الشاشة.
    widget.client.getCategory(widget.categoryId).then((category) {
      if (!mounted || seq != _seq) return;
      setState(() => _title = category.name);
    }).catchError((_) {});
    try {
      final page = await widget.client.listProducts(categoryId: widget.categoryId, perPage: _perPage, page: 1);
      if (!mounted || seq != _seq) return;
      setState(() {
        _items.addAll(page.items);
        _pagination = page.pagination;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _error = _messageOf(e);
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final pagination = _pagination;
    if (pagination == null || !pagination.hasMore || _loadingMore) return;
    final seq = _seq;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.client.listProducts(
        categoryId: widget.categoryId,
        perPage: _perPage,
        page: pagination.page + 1,
      );
      if (!mounted || seq != _seq) return;
      setState(() {
        _items.addAll(page.items);
        _pagination = page.pagination;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _error = _messageOf(e);
        _loadingMore = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final strings = RuntimeStrings.of(widget.locale);
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _items.isEmpty) return ErrorRetryView(message: _error!, onRetry: _load);
    if (_items.isEmpty) return Center(child: Text(strings.categoryEmpty));

    return ProductResults(
      items: _items,
      hasMore: _pagination?.hasMore ?? false,
      loadingMore: _loadingMore,
      onLoadMore: _loadMore,
      dispatcher: widget.dispatcher,
      locale: widget.locale,
      header: Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(_title ?? strings.categoryTitleFallback, style: Theme.of(context).textTheme.titleLarge),
      ),
    );
  }
}
