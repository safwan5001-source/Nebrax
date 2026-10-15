import type { ImgHTMLAttributes } from "react";
export const usePathname = () => location.pathname + location.search;
export const useCountrySwitch = () => ({
  isCartLoading: false,
  isCountryNavigating: false,
  handleCountrySelect: async () => false,
});
export default function Image({
  fill: _fill,
  unoptimized: _unoptimized,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  unoptimized?: boolean;
}) {
  // biome-ignore lint/performance/noImgElement: static browser proof deliberately substitutes next/image.
  return <img {...props} alt={props.alt ?? ""} />;
}
