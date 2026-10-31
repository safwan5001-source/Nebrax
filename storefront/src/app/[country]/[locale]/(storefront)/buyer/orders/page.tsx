import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BuyerOrdersList } from "@/components/wholesale-buyer/BuyerOrdersView";
import { getBuyerOrders } from "@/lib/data/wholesale-buyer";

interface Props {
  params: Promise<{ country: string; locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "wholesaleBuyer",
  });
  return { title: t("orders.title"), robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: Props) {
  const { country, locale } = await params;
  const raw = (await searchParams).page;
  const page =
    typeof raw === "string" && /^[1-9][0-9]{0,3}$/.test(raw) ? Number(raw) : 1;
  const result = await getBuyerOrders(page);

  return (
    <BuyerOrdersList
      result={result}
      page={page}
      basePath={`/${country}/${locale}`}
      locale={locale as Locale}
    />
  );
}
