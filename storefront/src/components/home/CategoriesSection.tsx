import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getCategories } from "@/lib/data/categories";

interface CategoriesSectionProps {
  basePath: string;
  locale: string;
  country: string;
}

export async function CategoriesSection({
  basePath,
  locale,
  country,
}: CategoriesSectionProps) {
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "header",
  });

  const categories = await getCategories({ depth_eq: 0 }, { country, locale })
    .then((res) => res.data ?? [])
    .catch((error) => {
      console.error("CategoriesSection: failed to load categories", error);
      return [];
    });

  if (categories.length === 0) {
    return null;
  }

  return (
    <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t("categories")}</h2>
        <Link
          href={`${basePath}/products`}
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          {t("allProducts")}
        </Link>
      </div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              href={`${basePath}/c/${category.permalink}`}
              className="block rounded-lg border border-gray-200 bg-white px-4 py-5 text-sm font-medium text-gray-900 hover:border-gray-300 hover:bg-gray-50"
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
