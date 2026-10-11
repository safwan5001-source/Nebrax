// CUST-HV V8e proof: `next/dynamic` needs the Next runtime the static proof pages do not have; React.lazy + Suspense is what it renders.
import { createElement, lazy, Suspense, type ComponentType } from "react";

export default function dynamic<P extends object>(
  loader: () => Promise<ComponentType<P>>,
): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await loader() }));
  return function Dynamic(props: P) {
    return createElement(Suspense, { fallback: null }, createElement(Lazy, props as never));
  };
}
