// CUST-HV V8e — proof entry: the page carries the production server markup of one gallery (publishedNodes → HomeGallery, rendered to static
// HTML) plus the exact props the production component received; this client-renders the REAL `HomeGallery` (and, on demand, the REAL viewer)
// over it, so the browser drives the real controls and keyboard against the real stylesheet. Without JavaScript the page is the static markup.
import { createRoot } from "react-dom/client";
import { HomeGallery } from "@/components/home/HomeGallery";

type Props = React.ComponentProps<typeof HomeGallery>;
const data = JSON.parse(
  (document.getElementById("gallery-props") as HTMLElement).textContent ?? "{}",
) as Props;
const host = document.getElementById("host") as HTMLElement;
const container = host.querySelector<HTMLElement>("[data-sd]") ?? host;
createRoot(container).render(<HomeGallery {...data} />);
