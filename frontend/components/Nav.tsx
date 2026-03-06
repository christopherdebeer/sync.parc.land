/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Shared navigation header — appears on all pages except OAuth authorize. */
import { useCallback, useEffect, useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";

const Bar = styled.nav`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 0.85rem;
  position: sticky;
  top: 0;
  z-index: 50;
  @media (max-width: 480px) {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
  }
`;

const Left = styled.div`
  display: flex;
  align-items: center;
  gap: 1.25rem;
`;

const Logo = styled.a`
  font-weight: 700;
  font-size: 1rem;
  color: var(--fg);
  text-decoration: none;
  letter-spacing: -0.03em;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  &:hover { text-decoration: none; }
`;

const LogoImg = styled.img`
  height: 1.4rem;
  width: 1.4rem;
`;

const NavLinks = styled.div`
  display: flex;
  gap: 0.9rem;
  @media (max-width: 480px) {
    gap: 0.6rem;
  }
`;

const NavLink = styled.a<{ $active?: boolean }>`
  color: ${({ $active }) => ($active ? "var(--accent)" : "var(--dim)")};
  text-decoration: none;
  font-weight: ${({ $active }) => ($active ? "600" : "400")};
  transition: color 0.15s;
  &:hover {
    color: var(--fg);
    text-decoration: none;
  }
`;

const Right = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ThemeBtn = styled.button`
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--dim);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  font-size: 0.82rem;
  line-height: 1;
  transition: all 0.15s;
  &:hover {
    color: var(--fg);
    border-color: var(--dim);
  }
`;

type Theme = "system" | "light" | "dark";

function getEffective(pref: Theme): "light" | "dark" {
  if (pref === "light" || pref === "dark") return pref;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

export interface NavProps {
  active?: "home" | "docs" | "manage" | "dashboard";
}

export function Nav({ active }: NavProps) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("sync-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  const cycle = useCallback(() => {
    const next: Theme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("sync-theme");
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem("sync-theme", next);
      document.documentElement.setAttribute("data-theme", next);
    }
  }, [theme]);

  const icon = getEffective(theme) === "dark" ? "\u263E" : "\u2600";

  return (
    <Bar>
      <Left>
        <Logo href="/">
          <LogoImg src="/static/favicon.svg" alt="" />
        </Logo>
        <NavLinks>
          <NavLink href="/" $active={active === "home"}>/sync</NavLink>
          <NavLink href="/?doc=SKILL.md" $active={active === "docs"}>Docs</NavLink>
          <NavLink href="/manage" $active={active === "manage"}>Manage</NavLink>
        </NavLinks>
      </Left>
      <Right>
        <ThemeBtn onClick={cycle} title={`Theme: ${theme}`}>
          {icon}
        </ThemeBtn>
      </Right>
    </Bar>
  );
}
