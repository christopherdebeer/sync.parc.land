/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Client hydration entry for Landing page. */
import { hydrateRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { Landing } from "../../components/Landing.tsx";

const root = document.getElementById("root");
if (root) {
  hydrateRoot(root, <Landing />);
}
