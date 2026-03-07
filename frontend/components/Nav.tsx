/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Shared navigation header — appears on all pages except OAuth authorize. */
import { useCallback, useEffect, useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { Logo } from "./Logo.tsx";

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

const LogoLink = styled.a`
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

const ThemeToggle = styled.div`
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
`;

const ThemeOption = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--surface2)" : "transparent")};
  border: none;
  color: ${({ $active }) => ($active ? "var(--fg)" : "var(--dim)")};
  cursor: pointer;
  padding: 0.2rem 0.45rem;
  font-size: 0.75rem;
  line-height: 1;
  transition: all 0.15s;
  &:hover {
    color: var(--fg);
  }
  & + & {
    border-left: 1px solid var(--border);
  }
`;

type Theme = "system" | "light" | "dark";

export interface NavProps {
  active?: "home" | "docs" | "examples" | "manage" | "dashboard";
}

export function Nav({ active }: NavProps) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("sync-theme");
    if (stored === "light" || stored === "dark") setTheme(stored);
  }, []);

  const pick = useCallback((t: Theme) => {
    setTheme(t);
    if (t === "system") {
      localStorage.removeItem("sync-theme");
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem("sync-theme", t);
      document.documentElement.setAttribute("data-theme", t);
    }
  }, []);

  return (
    <Bar>
      <Left>
        <LogoLink href="/">
          <Logo />
        </LogoLink>
        <NavLinks>
          <NavLink href="/" $active={active === "home"}>/sync</NavLink>
          <NavLink href="/?doc=SKILL.md" $active={active === "docs"}>Docs</NavLink>
          <NavLink href="/?doc=examples.md" $active={active === "examples"}>Examples</NavLink>
          <NavLink href="/manage" $active={active === "manage"}>Manage</NavLink>
        </NavLinks>
      </Left>
      <Right>
        <ThemeToggle>
          <ThemeOption $active={theme === "light"} onClick={() => pick("light")} title="Light">{"\u2600"}</ThemeOption>
          <ThemeOption $active={theme === "system"} onClick={() => pick("system")} title="System">{"\u25D0"}</ThemeOption>
          <ThemeOption $active={theme === "dark"} onClick={() => pick("dark")} title="Dark">{"\u263E"}</ThemeOption>
        </ThemeToggle>
      </Right>
    </Bar>
  );
}
