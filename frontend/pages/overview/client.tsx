/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Client hydration entry for Overview page. */
import { hydrateRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { Overview } from "../../components/Overview.tsx";

const root = document.getElementById("root");

if (root) {
  hydrateRoot(root, <Overview />);
  window.__HYDRATION_OK__?.();
}
