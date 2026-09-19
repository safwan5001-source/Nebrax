import { redirect } from "next/navigation";

interface GiftCardsPageProps {
  params: Promise<{ country: string; locale: string }>;
}

/** Leftover Spree surface — not part of the AWJ account. */
export default async function GiftCardsPage({ params }: GiftCardsPageProps) {
  const { country, locale } = await params;
  redirect(`/${country}/${locale}/account`);
}
