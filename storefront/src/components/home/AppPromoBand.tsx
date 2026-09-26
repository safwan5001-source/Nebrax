import { OfficialStoreBadge } from "@/components/store/OfficialStoreBadge";
import { isSafeAppStoreUrl, isSafePlayStoreUrl } from "@/lib/presentation/urls";

export function AppPromoBand({
  appName,
  iosUrl,
  androidUrl,
  title,
  appStoreLabel,
  playStoreLabel,
  locale,
}: {
  appName: string;
  iosUrl: string;
  androidUrl: string;
  title: string;
  appStoreLabel: string;
  playStoreLabel: string;
  locale: string;
}) {
  const ios = isSafeAppStoreUrl(iosUrl) ? iosUrl : "";
  const android = isSafePlayStoreUrl(androidUrl) ? androidUrl : "";
  if (!ios && !android) return null;
  const heading = appName.trim() || title;
  return (
    <section className="rounded-store bg-store-footer px-5 py-6 text-store-footer-foreground md:px-8">
      <h2 className="text-base font-extrabold md:text-lg">{heading}</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {ios ? (
          <OfficialStoreBadge
            store="apple"
            href={ios}
            locale={locale}
            label={appStoreLabel}
          />
        ) : null}
        {android ? (
          <OfficialStoreBadge
            store="google"
            href={android}
            locale={locale}
            label={playStoreLabel}
          />
        ) : null}
      </div>
    </section>
  );
}
