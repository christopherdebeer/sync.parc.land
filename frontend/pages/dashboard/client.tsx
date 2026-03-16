/** @jsxImportSource https://esm.sh/react@18.2.0?dev */
/** Client entry for Dashboard page — TEMP: using React dev build for error messages */
import React from "https://esm.sh/react@18.2.0?dev";
import { createRoot } from "https://esm.sh/react-dom@18.2.0?dev/client";

console.log("[dashboard-client] module loaded");

// Error boundary to catch render crashes
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[dashboard-client] React render error:", error);
    console.error("[dashboard-client] Component stack:", info?.componentStack);
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return React.createElement("div", {
        style: { padding: "2rem", fontFamily: "monospace", fontSize: "13px", color: "#f85149", background: "#0d1117", minHeight: "100vh" }
      },
        React.createElement("h2", { style: { color: "#f85149" } }, "Dashboard render error"),
        React.createElement("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: "1rem", padding: "1rem", background: "#161b22", borderRadius: "6px" } },
          String(this.state.error?.message || this.state.error)
        ),
        this.state.error?.stack && React.createElement("pre", {
          style: { whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: "0.5rem", padding: "1rem", background: "#161b22", borderRadius: "6px", color: "#484f58", fontSize: "11px" }
        }, this.state.error.stack),
        this.state.info?.componentStack && React.createElement("pre", {
          style: { whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: "0.5rem", padding: "1rem", background: "#161b22", borderRadius: "6px", color: "#58a6ff", fontSize: "11px" }
        }, "Component stack:" + this.state.info.componentStack)
      );
    }
    return this.props.children;
  }
}

try {
  console.log("[dashboard-client] importing Dashboard component...");
  const { Dashboard } = await import("../../components/Dashboard.tsx");
  console.log("[dashboard-client] Dashboard imported:", typeof Dashboard);

  const propsEl = document.getElementById("__PROPS__");
  const props = propsEl ? JSON.parse(propsEl.textContent) : {};
  console.log("[dashboard-client] props:", JSON.stringify(props));

  const root = document.getElementById("root");
  console.log("[dashboard-client] root element:", root ? "found" : "MISSING");

  if (root) {
    console.log("[dashboard-client] calling createRoot...");
    const reactRoot = createRoot(root);
    console.log("[dashboard-client] rendering with ErrorBoundary...");
    reactRoot.render(
      React.createElement(ErrorBoundary, null,
        React.createElement(Dashboard, { roomId: props.roomId })
      )
    );
    console.log("[dashboard-client] render() called — React should mount");
  }
} catch (err) {
  console.error("[dashboard-client] FATAL:", err);
  console.error("[dashboard-client] stack:", err?.stack);
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = '<div style="padding:2rem;font-family:monospace;color:#f85149;background:#0d1117;min-height:100vh">' +
      '<h2>Dashboard load error</h2>' +
      '<pre style="white-space:pre-wrap;word-break:break-all;margin-top:1rem;padding:1rem;background:#161b22;border-radius:6px">' +
      (err?.message || String(err)) + '</pre>' +
      '<pre style="white-space:pre-wrap;font-size:11px;color:#484f58;margin-top:0.5rem;padding:1rem;background:#161b22;border-radius:6px">' +
      (err?.stack || '') + '</pre></div>';
  }
}
