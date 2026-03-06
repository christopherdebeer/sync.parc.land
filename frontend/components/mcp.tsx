/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Shared styled components for MCP auth pages (authorize, manage, recover).
 *
 * Uses the dark dashboard theme. These components are isomorphic —
 * they render correctly both in SSR (renderToString) and client hydration.
 */
import { styled, css } from "../styled.ts";

// ─── Layout ──────────────────────────────────────────────────────

export const PageWrapper = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg, #0d1117);
  color: var(--fg, #c9d1d9);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const Container = styled.div<{ $wide?: boolean }>`
  width: 100%;
  max-width: ${({ $wide }) => ($wide ? "720px" : "420px")};
  padding: 1rem;
`;

export const Card = styled.div`
  background: var(--surface, #161b22);
  border: 1px solid var(--border, #21262d);
  border-radius: 12px;
  padding: 2rem;
`;

// ─── Typography ──────────────────────────────────────────────────

export const Title = styled.h1`
  font-size: 1.5rem;
  margin-bottom: 0.75rem;
  font-weight: 600;
`;

export const TitleDim = styled.span`
  color: var(--dim, #484f58);
`;

export const Subtitle = styled.p`
  color: #999;
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
  line-height: 1.5;

  strong {
    color: var(--fg, #c9d1d9);
  }
`;

// ─── Forms ───────────────────────────────────────────────────────

export const Label = styled.label`
  display: block;
  font-size: 0.8rem;
  color: #999;
  margin-bottom: 0.3rem;
`;

export const Input = styled.input`
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border, #21262d);
  border-radius: 8px;
  background: var(--bg, #0d1117);
  color: var(--fg, #c9d1d9);
  font-size: 0.95rem;
  margin-bottom: 1rem;
  outline: none;
  transition: border-color 0.2s;
  font-family: inherit;

  &:focus {
    border-color: var(--accent, #58a6ff);
  }
`;

// ─── Buttons ─────────────────────────────────────────────────────

export const PrimaryButton = styled.button`
  width: 100%;
  padding: 0.7rem;
  border: none;
  border-radius: 8px;
  background: var(--accent, #58a6ff);
  color: white;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  font-family: inherit;

  &:hover {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const SecondaryButton = styled.button`
  padding: 0.7rem 1.5rem;
  border: 1px solid var(--border, #21262d);
  border-radius: 8px;
  background: transparent;
  color: #999;
  font-size: 0.95rem;
  cursor: pointer;
  font-family: inherit;
`;

// ─── Status & Feedback ──────────────────────────────────────────

export const StatusText = styled.p`
  color: #888;
  font-size: 0.85rem;
  margin-top: 0.75rem;
  min-height: 1.2em;
`;

export const ErrorText = styled.p`
  color: var(--red, #f85149);
  font-size: 0.85rem;
  margin-top: 0.5rem;
  min-height: 1.2em;
`;

export const SuccessText = styled.p`
  color: var(--green, #3fb950);
  font-size: 0.9rem;
`;

// ─── Links ───────────────────────────────────────────────────────

export const AccentLink = styled.a`
  color: var(--accent, #58a6ff);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;
