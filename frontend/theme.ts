/** Shared design tokens for styled-components.
 *
 * These match the CSS custom properties in shell.ts :root.
 * Use in styled-components via ${({ theme }) => theme.bg} or import directly.
 *
 * Note: the dashboard uses a dark theme always. Landing/docs pages use
 * the "landing" subset which is light-default with dark media query.
 * The MCP auth pages use the dark dashboard theme.
 */

export const theme = {
  // Core dark palette (dashboard + MCP pages)
  bg: "#0d1117",
  fg: "#c9d1d9",
  dim: "#484f58",
  border: "#21262d",
  accent: "#58a6ff",
  green: "#3fb950",
  yellow: "#d29922",
  red: "#f85149",
  surface: "#161b22",
  surface2: "#1c2129",
  purple: "#bc8cff",
  orange: "#f0883e",

  // Typography
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  monoFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',

  // Spacing
  radius: "8px",
  radiusSm: "4px",
  radiusLg: "12px",
} as const;

export type Theme = typeof theme;
