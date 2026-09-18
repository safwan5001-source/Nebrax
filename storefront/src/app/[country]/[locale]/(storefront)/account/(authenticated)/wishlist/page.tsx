import { AccountWishlist } from "@/components/account/AccountWishlist";

interface WishlistPageProps {
  params: Promise<{ country: string; locale: string }>;
}

export default async function WishlistPage({ params }: WishlistPageProps) {
  const { country, locale } = await params;
  return <AccountWishlist basePath={`/${country}/${locale}`} />;
}
