import 'package:flutter/widgets.dart';

/// This runtime's own UI chrome strings (MOBILE-RUNTIME-6, MR-10
/// Localization). Covers **only** first-party UI text this runtime itself
/// authors — static schema labels (`runtime_schema.dart`), screen chrome
/// (`home_screen.dart`/`product_screen.dart`/`cart_screen.dart`), and
/// generic status views (`runtime_status_views.dart`).
///
/// This is deliberately **not** a general translation layer: per MR-10's
/// "no duplicated business translation authority", product/category names
/// are never translated here — `CommerceProductSummary`/`CommerceProductDetail`
/// already carry both `name` (Arabic) and `nameEn` (English) from the
/// server (`docs/openapi/commerce-api-v1.yaml`), and a screen picks the
/// field matching the current locale (see this file's own
/// `localizedProductName`) rather than this class inventing a second,
/// client-side translation of server-owned data. Server error messages
/// (`CommerceApiException.message`) are shown as-is for the same reason —
/// `Accept-Language` (sent by `CommerceClient`, see
/// `commerce_client.dart`'s `setLocale`) already makes the server return
/// them in the request's resolved locale, per `ADR-12`/`COM-MOBILE-I18N-1`.
class RuntimeStrings {
  final String languageCode;
  final String tagline;
  final String goToCart;
  final String continueShopping;
  final String removeItem;
  final String goHome;
  final String addToCart;
  final String outOfStock;
  final String incompatibleTitle;
  final String connectionError;
  final String retry;
  final String pageNotFound;
  final String productLoadError;
  final String homeLoadError;
  final String cartLoadError;
  final String quantityDecrease;
  final String quantityIncrease;
  final String removeCartLine;
  final String languageToggleLabel;
  final String optionPrefix;

  const RuntimeStrings._({
    required this.languageCode,
    required this.tagline,
    required this.goToCart,
    required this.continueShopping,
    required this.removeItem,
    required this.goHome,
    required this.addToCart,
    required this.outOfStock,
    required this.incompatibleTitle,
    required this.connectionError,
    required this.retry,
    required this.pageNotFound,
    required this.productLoadError,
    required this.homeLoadError,
    required this.cartLoadError,
    required this.quantityDecrease,
    required this.quantityIncrease,
    required this.removeCartLine,
    required this.languageToggleLabel,
    required this.optionPrefix,
  });

  /// A simplified but genuinely plural-aware Arabic cart-item count
  /// (Arabic's own dual/plural forms — this does not claim full ICU
  /// `MessageFormat` coverage, which this proof-scope task has no need
  /// for): 0 → "لا عناصر", 1 → "عنصر واحد", 2 → "عنصران", 3–10 → "N عناصر",
  /// 11+ → "N عنصرًا". English uses the ordinary singular/plural split.
  String itemsCount(int count) {
    if (languageCode == 'en') {
      return count == 1 ? '1 item' : '$count items';
    }
    if (count == 0) return 'لا عناصر';
    if (count == 1) return 'عنصر واحد';
    if (count == 2) return 'عنصران';
    if (count >= 3 && count <= 10) return '$count عناصر';
    return '$count عنصرًا';
  }

  static const RuntimeStrings _ar = RuntimeStrings._(
    languageCode: 'ar',
    tagline: 'تسوّق منتجاتك المفضّلة',
    goToCart: 'عرض السلة',
    continueShopping: 'متابعة التسوق',
    removeItem: 'إزالة',
    goHome: 'الرئيسية',
    addToCart: 'إضافة للسلة',
    outOfStock: 'غير متوفر',
    incompatibleTitle: 'هذا الإصدار لا يدعم هذه الشاشة',
    connectionError: 'تعذّر الاتصال بالخدمة',
    retry: 'إعادة المحاولة',
    pageNotFound: 'الصفحة غير موجودة',
    productLoadError: 'تعذّر تحميل المنتج',
    homeLoadError: 'تعذّر تحميل الصفحة الرئيسية',
    cartLoadError: 'تعذّر تحميل السلة',
    quantityDecrease: 'إنقاص الكمية',
    quantityIncrease: 'زيادة الكمية',
    removeCartLine: 'إزالة هذا العنصر من السلة',
    languageToggleLabel: 'English',
    optionPrefix: 'خيار',
  );

  static const RuntimeStrings _en = RuntimeStrings._(
    languageCode: 'en',
    tagline: 'Shop your favorite products',
    goToCart: 'View cart',
    continueShopping: 'Continue shopping',
    removeItem: 'Remove',
    goHome: 'Home',
    addToCart: 'Add to cart',
    outOfStock: 'Out of stock',
    incompatibleTitle: 'This version does not support this screen',
    connectionError: 'Could not connect to the service',
    retry: 'Retry',
    pageNotFound: 'Page not found',
    productLoadError: 'Could not load the product',
    homeLoadError: 'Could not load the home page',
    cartLoadError: 'Could not load the cart',
    quantityDecrease: 'Decrease quantity',
    quantityIncrease: 'Increase quantity',
    removeCartLine: 'Remove this item from the cart',
    languageToggleLabel: 'العربية',
    optionPrefix: 'Option',
  );

  static RuntimeStrings of(Locale locale) =>
      locale.languageCode == 'en' ? _en : _ar;
}

/// Picks the Commerce API field matching [locale] from a product/category's
/// own already-bilingual pair — never a client-side translation of
/// server-owned data (see this class's own doc comment). Falls back to
/// [name] when [nameEn] is null (an English-locale product a merchant
/// simply hasn't given an English name yet), never to an empty string.
String localizedProductName(String name, String? nameEn, Locale locale) {
  if (locale.languageCode == 'en' && nameEn != null && nameEn.isNotEmpty) {
    return nameEn;
  }
  return name;
}
