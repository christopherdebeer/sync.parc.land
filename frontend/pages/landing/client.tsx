/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Client hydration entry for Landing page. All content is pre-rendered server-side. */
import { hydrateRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { Landing } from "../../components/Landing.tsx";
import type { LandingData } from "../../components/Landing.tsx";

const root = document.getElementById("root");
const propsEl = document.getElementById("__PROPS__");
const props = propsEl ? JSON.parse(propsEl.textContent || "{}") : {};

if (root) {
  hydrateRoot(root, <Landing data={props.data as LandingData | undefined} />);
}
