/// AD-04 / S09a — ثوابت عقد غلاف التنقل (`navigation.tabs[]` و`navigation.appBar`).
/// تطابق `App\Services\AppBuilder\NavigationShell` (PHP) حرفياً، ويحرس التطابق ملف حالات مشترك
/// (`contracts/app-builder/navigation-shell.v1.json`) تقرؤه اختبارات الجانبين.
class NavigationShell {
  const NavigationShell._();

  static const featureTabs = 'navigation.tabs';
  static const featureAppBar = 'navigation.appBar';

  /// أيقونات مسموحة (قائمة مغلقة؛ لا رفع أيقونات قبل خط الوسائط AD-07).
  static const tabIcons = ['home', 'search', 'category', 'cart', 'favorite', 'person', 'menu', 'orders', 'store', 'offers'];

  static const tabKeys = {'pageId', 'title', 'icon', 'hidden'};
  static const appBarKeys = {'title', 'showCart'};

  static const maxTabs = 8;
  static const maxVisibleTabs = 5;
  static const maxTabTitle = 24;
  static const maxAppBarTitle = 40;
}
