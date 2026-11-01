import 'package:flutter/material.dart';

import '../actions/actions.dart';
import '../commerce/commerce.dart';
import '../registry/registry.dart';
import '../schema/schema.dart';
import 'runtime_strings.dart';

/// S11 — شبكة نتائج منتجات مشتركة بين شاشتَي التصنيف والبحث.
///
/// تُرسَم بالسجل نفسه (`ProductCard` عبر `ComponentView` + إجراء `openProduct`) فيتطابق الشكل مع بقية التطبيق، وتُبنى كسولاً
/// بالصفوف (`ListView.builder`، عمودان لكل صف بـ`Expanded`) فلا تُبنى كل النتائج دفعةً واحدة وتحتمل ارتفاعات متفاوتة.
/// الترقيم: زر «عرض المزيد» يظهر فقط حين يقول الخادم `hasMore` (لا تمرير لا نهائي يخمّنه العميل).
class ProductResults extends StatelessWidget {
  final List<CommerceProductSummary> items;
  final bool hasMore;
  final bool loadingMore;
  final VoidCallback onLoadMore;
  final AppActionDispatcher dispatcher;
  final Locale locale;
  final Widget? header;

  const ProductResults({
    super.key,
    required this.items,
    required this.hasMore,
    required this.loadingMore,
    required this.onLoadMore,
    required this.dispatcher,
    required this.locale,
    this.header,
  });

  static const int _columns = 2;

  SchemaComponent _card(CommerceProductSummary product) {
    return SchemaComponent(
      type: 'ProductCard',
      id: 'result-${product.id}',
      optional: false,
      props: {
        'title': localizedProductName(product.name, product.nameEn, locale),
        'amountMinor': product.price.amountMinor,
        if (product.thumbnailUrl != null) 'imageUrl': product.thumbnailUrl,
      },
      children: const [],
      action: ActionRef(type: 'openProduct', params: {'productId': product.id}),
    );
  }

  @override
  Widget build(BuildContext context) {
    final strings = RuntimeStrings.of(locale);
    final rows = (items.length / _columns).ceil();
    final headerCount = header == null ? 0 : 1;
    final footerCount = hasMore ? 1 : 0;

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: headerCount + rows + footerCount,
      itemBuilder: (context, index) {
        if (header != null && index == 0) return header!;
        final rowIndex = index - headerCount;
        if (rowIndex >= rows) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Center(
              child: loadingMore
                  ? const CircularProgressIndicator()
                  : OutlinedButton(onPressed: onLoadMore, child: Text(strings.loadMore)),
            ),
          );
        }
        final start = rowIndex * _columns;
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var c = 0; c < _columns; c++) ...[
                if (c > 0) const SizedBox(width: 12),
                Expanded(
                  child: start + c < items.length
                      ? ComponentView(node: _card(items[start + c]), onAction: dispatcher.dispatch)
                      : const SizedBox.shrink(),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
