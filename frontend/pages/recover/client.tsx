/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Client hydration entry for RecoverPage.
 *
 * Reads serialized props from the __PROPS__ script tag,
 * hydrates the server-rendered HTML with React interactivity.
 */
import { hydrateRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { RecoverPage } from "./RecoverPage.tsx";

const propsEl = document.getElementById("__PROPS__");
const props = propsEl ? JSON.parse(propsEl.textContent!) : {};

const root = document.getElementById("root");
if (root) {
  hydrateRoot(root, <RecoverPage {...props} />);
}
