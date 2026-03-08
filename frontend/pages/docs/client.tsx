/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Client hydration entry for doc pages (DocPage and DocsIndex). */
import { hydrateRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { DocPage, DocsIndex } from "../../components/DocViewer.tsx";

const propsEl = document.getElementById("__PROPS__");
const props = propsEl ? JSON.parse(propsEl.textContent!) : {};

const root = document.getElementById("root");
if (root) {
  // DocsIndex pages have a `docs` array prop; DocPage pages have `slug`
  if (props.docs) {
    hydrateRoot(root, <DocsIndex docs={props.docs} />);
  } else {
    hydrateRoot(root, <DocPage slug={props.slug} title={props.title} html={props.html} rawPath={props.rawPath} />);
  }
}
