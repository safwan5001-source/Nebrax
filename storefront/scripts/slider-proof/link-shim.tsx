// CUST-HV V7d-3 proof: `next/link` needs the App Router context the static proof pages do not have; a plain anchor is what it renders.
import { type AnchorHTMLAttributes, forwardRef } from "react";

const Link = forwardRef<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }
>(function Link({ prefetch: _prefetch, ...props }, ref) {
  return <a ref={ref} {...props} />;
});
export default Link;
