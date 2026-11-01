import 'dart:async';

import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import 'product_results.dart';
import 'runtime_status_views.dart';
import 'runtime_strings.dart';

/// S11 (الجيل 1.2.0) — البحث: شاشة أصلية تفتحها `openSearch`، نتائجها حيّة من `GET products?search=` (الخادم وحده يقرّر ما
/// يظهر: نشر القناة وعزل المستأجر). النص يُقصّ إلى 120 حرفاً (حدّ العقد)، وأقل من حرفين لا يطلق طلباً، والطلب مؤجَّل
/// 350ms بعد آخر ضغطة، وردٌّ أقدم لا يكتب فوق الأحدث.
class SearchScreen extends StatefulWidget {
  final CommerceClient client;
  final AppActionDispatcher dispatcher;
  final Locale locale;

  const SearchScreen({super.key, required this.client, required this.dispatcher, required this.locale});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  static const int _perPage = 24;
  static const int _maxQueryLength = 120;
  static const int _minQueryLength = 2;
  static const Duration debounce = Duration(milliseconds: 350);

  final TextEditingController _controller = TextEditingController();
  Timer? _timer;
  final List<CommerceProductSummary> _items = [];
  CommercePaginationInfo? _pagination;
  String _activeQuery = '';
  String? _error;
  bool _loading = false;
  bool _loadingMore = false;
  int _seq = 0;

  @override
  void dispose() {
    _timer?.cancel();
    _seq++;
    _controller.dispose();
    super.dispose();
  }

  String _normalized(String raw) {
    final trimmed = raw.trim();
    return trimmed.length > _maxQueryLength ? trimmed.substring(0, _maxQueryLength) : trimmed;
  }

  void _onChanged(String raw) {
    _timer?.cancel();
    final query = _normalized(raw);
    if (query.length < _minQueryLength) {
      // أقل من الحدّ الأدنى: تُلغى الطلبات الجارية وتعود الشاشة لحالة الإرشاد.
      _seq++;
      setState(() {
        _items.clear();
        _pagination = null;
        _activeQuery = '';
        _error = null;
        _loading = false;
      });
      return;
    }
    _timer = Timer(debounce, () => _search(query));
  }

  String _messageOf(Object e) {
    if (e is CommerceApiException) return e.message;
    if (e is CommerceProtocolException) return e.message;
    return RuntimeStrings.of(widget.locale).connectionError;
  }

  Future<void> _search(String query) async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _activeQuery = query;
      _items.clear();
      _pagination = null;
    });
    try {
      final page = await widget.client.listProducts(search: query, perPage: _perPage, page: 1);
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
      final page = await widget.client.listProducts(search: _activeQuery, perPage: _perPage, page: pagination.page + 1);
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
    final field = Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: TextField(
        controller: _controller,
        autofocus: true,
        textInputAction: TextInputAction.search,
        onChanged: _onChanged,
        onSubmitted: (raw) {
          _timer?.cancel();
          final query = _normalized(raw);
          if (query.length >= _minQueryLength) _search(query);
        },
        decoration: InputDecoration(
          prefixIcon: const Icon(Icons.search),
          hintText: strings.searchHint,
          border: const OutlineInputBorder(),
        ),
      ),
    );

    final Widget body;
    if (_loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error != null && _items.isEmpty) {
      body = ErrorRetryView(message: _error!, onRetry: () => _search(_activeQuery));
    } else if (_activeQuery.isEmpty) {
      body = Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(strings.searchPrompt, textAlign: TextAlign.center)));
    } else if (_items.isEmpty) {
      body = Center(child: Text(strings.searchEmpty));
    } else {
      body = ProductResults(
        items: _items,
        hasMore: _pagination?.hasMore ?? false,
        loadingMore: _loadingMore,
        onLoadMore: _loadMore,
        dispatcher: widget.dispatcher,
        locale: widget.locale,
      );
    }

    return Column(children: [field, Expanded(child: body)]);
  }
}
