// CUST-HV V8b — proof entry: the page carries the production server markup of one slider (publishedNodes → HomeSlider, rendered to static
// HTML) plus the exact props the production component received; this client-renders the REAL `HomeSlider` over it, so the browser drives the
// real controls, timers and swipe against the real stylesheet. Without JavaScript the page is the static markup (the no-JS check).
import { createRoot } from "react-dom/client";
import { HomeSlider } from "@/components/home/HomeSlider";

type Props = React.ComponentProps<typeof HomeSlider>;
const data = JSON.parse(
  (document.getElementById("slider-props") as HTMLElement).textContent ?? "{}",
) as Props;
const host = document.getElementById("host") as HTMLElement;
// a designed slider sits inside its section-design frame; the frame keeps its attributes and the slider replaces only its child
const container = host.querySelector<HTMLElement>("[data-sd]") ?? host;
createRoot(container).render(<HomeSlider {...data} />);
