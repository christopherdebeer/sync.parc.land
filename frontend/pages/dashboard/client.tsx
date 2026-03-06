/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Client hydration entry for Dashboard page. */
import { hydrateRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { Dashboard } from "../../components/Dashboard.tsx";

const propsEl = document.getElementById("__PROPS__");
const props = propsEl ? JSON.parse(propsEl.textContent!) : {};

const root = document.getElementById("root");
if (root) {
  hydrateRoot(root, <Dashboard roomId={props.roomId} />);
}
