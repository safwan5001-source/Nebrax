export function AppPromoBand({
  appName,
  iosUrl,
  androidUrl,
  title,
  appStoreLabel,
  playStoreLabel,
}: {
  appName: string;
  iosUrl: string;
  androidUrl: string;
  title: string;
  appStoreLabel: string;
  playStoreLabel: string;
}) {
  if (!iosUrl && !androidUrl) return null;
  const heading = appName.trim() || title;
  return (
    <section className="rounded-store bg-store-footer px-5 py-6 text-store-footer-foreground md:px-8">
      <h2 className="text-base font-extrabold md:text-lg">{heading}</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {iosUrl ? (
          <a
            href={iosUrl}
            className="inline-flex h-10 items-center rounded-store bg-white px-4 text-sm font-bold text-store-foreground"
          >
            {appStoreLabel}
          </a>
        ) : null}
        {androidUrl ? (
          <a
            href={androidUrl}
            className="inline-flex h-10 items-center rounded-store bg-white px-4 text-sm font-bold text-store-foreground"
          >
            {playStoreLabel}
          </a>
        ) : null}
      </div>
    </section>
  );
}
