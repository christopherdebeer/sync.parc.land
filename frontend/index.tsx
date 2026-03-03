/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client";
import { createBrowserRouter, RouterProvider } from "https://esm.sh/react-router-dom@6.22.2?deps=react@18.2.0&react-dom@18.2.0";
import { StrictMode } from "https://esm.sh/react@18.2.0";
import { App } from "./components/App.tsx";

const router = createBrowserRouter([{ path: "/", element: <App /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("No root element found");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
