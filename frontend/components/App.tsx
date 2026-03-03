/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useSearchParams } from "https://esm.sh/react-router-dom@6.22.2?deps=react@18.2.0&react-dom@18.2.0";
import { Landing } from "./Landing.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { DocViewer } from "./DocViewer.tsx";

export function App() {
  const [params] = useSearchParams();
  const roomId = params.get("room");
  const docId = params.get("doc");
  if (roomId) return <Dashboard roomId={roomId} />;
  if (docId) return <DocViewer docId={docId} />;
  return <Landing />;
}
